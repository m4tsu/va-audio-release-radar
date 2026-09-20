// scripts/d1-export-local.mjs
//
// 手元の D1 の中身を、本番 D1 に流し込める SQL に書き出す。
//
//   npm run db:export:local                      # work/d1-export/local-<日時>.sql に書く
//   npm run db:export:local -- --output x.sql
//   npm run db:export:local -- --include-store audible
//   npm run db:export:local -- --table voice_actors --table audio_works   # 表を絞る (日を分けて流すとき)
//
// 既定で Audible の行を除く。手元の Audible のデータには、robots.txt が禁じる並び順付き URL で
// 取った分が混じっているため (docs/stores/audible.md の robots.txt の節)。
// スキーマは書き出さない。本番にはマイグレーションで当てる (README の「本番 D1」)。
// sqlite は読み取り専用で開き、全表を 1 つの読み取りトランザクションで読む。クロールが
// 書き込み中でも、表の間で断面がずれて外部キー違反の SQL になることを避けるため

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { findD1SqliteFile } from "./check-migrations.mjs";
import {
  countIndexesByTable,
  estimateWriteRows,
  exportSql,
  formatCounts,
  formatWriteRows,
} from "./d1-data.mjs";

/** マイグレーションの SQL を 1 つにつなぐ。索引の本数を数えるため */
function readMigrationSql(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(path.join(dir, name), "utf8"))
    .join("\n");
}

const D1_STATE_DIR = path.join(".wrangler", "state", "v3", "d1", "miniflare-D1DatabaseObject");
const DEFAULT_EXCLUDED_STORES = ["audible"];

/** `deps` はテストから差し替えるためのもの。既定は手元の D1 を見る */
export function main(argv, deps = {}) {
  const {
    d1StateDir = path.join(process.cwd(), D1_STATE_DIR),
    migrationsDir = path.join(process.cwd(), "migrations"),
    log = console.log,
    error = console.error,
  } = deps;

  const { values } = parseArgs({
    args: argv,
    options: {
      output: { type: "string" },
      "include-store": { type: "string", multiple: true },
      table: { type: "string", multiple: true },
    },
  });

  const sqliteFile = findD1SqliteFile(d1StateDir);
  if (!sqliteFile) {
    error("手元の D1 が無い (.wrangler/state)。先に npm run db:migrate:local を実行する");
    return 1;
  }

  const included = values["include-store"] ?? [];
  const excludeStores = DEFAULT_EXCLUDED_STORES.filter((store) => !included.includes(store));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const output = values.output ?? path.join("work", "d1-export", `local-${stamp}.sql`);

  const db = new DatabaseSync(sqliteFile, { readOnly: true });
  try {
    db.exec("BEGIN");
    const { sql, counts } = exportSql(db, { excludeStores, onlyTables: values.table });
    db.exec("ROLLBACK");
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(output, sql, "utf8");
    log(`書き出した: ${output}`);
    if (excludeStores.length > 0) log(`除いたストア: ${excludeStores.join(", ")}`);
    log(formatCounts(counts));

    // 流し込みで書かれる行数。Free プランの 1 日の上限に収まるかをここで判断する
    // (README の「本番 D1」)。索引への書き込みも数えるので、件数そのものとは違う
    const estimate = estimateWriteRows(counts, countIndexesByTable(readMigrationSql(migrationsDir)));
    log("\n流し込みで書かれる行数の見積もり (索引への書き込みを含む)");
    log(formatWriteRows(estimate));
  } finally {
    db.close();
  }
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exit(main(process.argv.slice(2)));
}
