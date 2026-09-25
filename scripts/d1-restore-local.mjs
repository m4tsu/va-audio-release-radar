// scripts/d1-restore-local.mjs
//
// 書き出した SQL から手元の D1 を作り直す。本番 D1 の複製を手元に置くために使う。
// 渡すのは本番の週次バックアップ (wrangler の `d1 export --no-schema` の出力) か、
// `npm run db:export:local` の出力。
//
//   npm run db:restore:local -- --file backup.sql --yes
//
// 手順: クロール中でないことを確かめる → マイグレーションを当てる → 全データ表の DELETE と
// ファイルの INSERT を 1 つのファイルにまとめて 1 回で流す → 件数を出す。
// 1 回で流すのは、途中で失敗したときに空のまま残さないため (D1 はファイル全体を 1 つの
// トランザクションとして扱う)。ファイル側は `prepareImportSql` で表の順序を親から順に直し、
// マイグレーションの記録などデータでない文を捨てる。
//
// 手元の D1 は同じマシンの全セッションが共有しているので (CLAUDE.md の「ローカルの共有資源」)、
// `--yes` が無ければ何もしない。書き込みはすべて wrangler 経由で行い、sqlite ファイルを直接触らない。
// `--persist-to` を渡さないので E2E 用の D1 (.wrangler-e2e) には触れない

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  countSql,
  formatCounts,
  listDataTables,
  parseCounts,
  prepareImportSql,
  truncateSql,
} from "./d1-data.mjs";
import { D1_STATE_DIR, latestRunStartedAt, RECENT_RUN_MS, readLocalD1 } from "./local-d1.mjs";

/** まとめた SQL の置き場。git 管理外 */
const STAGING_DIR = path.join("work", "d1-export");

function wrangler(args, options = {}) {
  return execFileSync("npx", ["wrangler", ...args], { stdio: "pipe", encoding: "utf8", ...options });
}

/**
 * `deps` はテストから差し替えるためのもの。既定は wrangler を実際に呼ぶ
 */
export function main(argv, deps = {}) {
  const {
    now = Date.now(),
    run = wrangler,
    d1StateDir = path.join(process.cwd(), D1_STATE_DIR),
    stagingDir = STAGING_DIR,
    log = console.log,
    error = console.error,
  } = deps;

  const { values } = parseArgs({
    args: argv,
    options: { file: { type: "string" }, yes: { type: "boolean" } },
  });
  if (!values.file || !existsSync(values.file)) {
    error("--file に書き出した SQL のパスを渡す");
    return 1;
  }
  if (values.yes !== true) {
    error("手元の D1 の中身をすべて入れ替える。実行するには --yes を付ける");
    return 1;
  }

  const latest = readLocalD1(d1StateDir, latestRunStartedAt) ?? null;
  if (latest !== null && now - Date.parse(latest) < RECENT_RUN_MS) {
    error(`直近 (${latest}) に取り込みの記録がある。クロールが終わるまで待つ`);
    return 1;
  }

  run(["d1", "migrations", "apply", "DB", "--local"], { stdio: "inherit" });

  const tables = readLocalD1(d1StateDir, listDataTables);
  if (tables === undefined) {
    error("マイグレーションを当てた後も手元の D1 が見つからない");
    return 1;
  }

  const prepared = prepareImportSql(readFileSync(values.file, "utf8"), tables);
  if (prepared.statements === 0) {
    error("ファイルにデータの表への INSERT が無い");
    return 1;
  }
  mkdirSync(stagingDir, { recursive: true });
  const staged = path.join(stagingDir, `restore-${now}.sql`);
  writeFileSync(staged, `${truncateSql(tables)}\n${prepared.sql}`, "utf8");
  log(`流し込む文: ${prepared.statements} (データでない文を ${prepared.dropped} 捨てた) → ${staged}`);

  try {
    run(["d1", "execute", "DB", "--local", "-y", "--file", staged], { stdio: "inherit" });
  } finally {
    // DB 全体の複製なので、残すと復元のたびに積み上がる。失敗しても消す (同じファイルは作り直せる)
    rmSync(staged, { force: true });
  }

  const out = run(["d1", "execute", "DB", "--local", "-y", "--json", "--command", countSql(tables)]);
  log(formatCounts(parseCounts(JSON.parse(out)[0].results[0])));
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exit(main(process.argv.slice(2)));
}
