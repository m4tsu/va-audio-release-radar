// scripts/d1-restore-local.mjs
//
// 書き出した SQL から手元の D1 を作り直す。本番 D1 の複製を手元に置くために使う。
//
//   npm run db:restore:local -- --file backup.sql --yes
//
// 手順: マイグレーションを当てる → 全データ表を空にする → SQL を流す → 件数を出す。
// 手元の D1 は同じマシンの全セッションが共有しているので (CLAUDE.md の「ローカルの共有資源」)、
// `--yes` が無ければ何もしない。直近数分に取り込みの記録があれば、クロールが走っている
// とみなして止まる。書き込みはすべて wrangler 経由で行い、sqlite ファイルを直接触らない。
// E2E 用の D1 (.wrangler-e2e) には触れない

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { findD1SqliteFile } from "./check-migrations.mjs";
import { countSql, formatCounts, listDataTables, parseCounts, truncateSql } from "./d1-data.mjs";

const D1_STATE_DIR = path.join(".wrangler", "state", "v3", "d1", "miniflare-D1DatabaseObject");
/** これより新しい取り込みの記録があれば、別のプロセスがクロール中とみなす */
const RECENT_RUN_MS = 10 * 60 * 1000;

function wrangler(args) {
  execFileSync("npx", ["wrangler", ...args], { stdio: "inherit" });
}

/** 直近の取り込みの記録。表が無い (作り立て) なら null */
export function latestRunStartedAt(db) {
  const exists = db
    .prepare("select 1 from sqlite_master where type = 'table' and name = 'crawl_runs'")
    .get();
  if (!exists) return null;
  const row = db.prepare("select max(started_at) as at from crawl_runs").get();
  return row?.at ?? null;
}

export function main(argv, now = Date.now()) {
  const { values } = parseArgs({
    args: argv,
    options: { file: { type: "string" }, yes: { type: "boolean" } },
  });
  if (!values.file || !existsSync(values.file)) {
    console.error("--file に書き出した SQL のパスを渡す");
    return 1;
  }
  if (values.yes !== true) {
    console.error("手元の D1 の中身をすべて入れ替える。実行するには --yes を付ける");
    return 1;
  }

  wrangler(["d1", "migrations", "apply", "DB", "--local"]);

  const sqliteFile = findD1SqliteFile(path.join(process.cwd(), D1_STATE_DIR));
  if (!sqliteFile) {
    console.error("マイグレーションを当てた後も手元の D1 が見つからない");
    return 1;
  }
  const db = new DatabaseSync(sqliteFile, { readOnly: true });
  let tables;
  try {
    const latest = latestRunStartedAt(db);
    if (latest !== null && now - Date.parse(latest) < RECENT_RUN_MS) {
      console.error(`直近 (${latest}) に取り込みの記録がある。クロールが終わるまで待つ`);
      return 1;
    }
    tables = listDataTables(db);
  } finally {
    db.close();
  }

  wrangler(["d1", "execute", "DB", "--local", "-y", "--command", truncateSql(tables)]);
  wrangler(["d1", "execute", "DB", "--local", "-y", "--file", values.file]);

  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "DB", "--local", "-y", "--json", "--command", countSql(tables)],
    { encoding: "utf8" },
  );
  console.log(formatCounts(parseCounts(JSON.parse(out)[0].results[0])));
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exit(main(process.argv.slice(2)));
}
