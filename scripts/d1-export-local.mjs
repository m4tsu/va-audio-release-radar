// scripts/d1-export-local.mjs
//
// 手元の D1 の中身を、本番 D1 に流し込める SQL に書き出す。
//
//   npm run db:export:local                      # work/d1-export/local-<日時>.sql に書く
//   npm run db:export:local -- --output x.sql
//   npm run db:export:local -- --include-store audible
//
// 既定で Audible の行を除く。手元の Audible のデータには、robots.txt が禁じる並び順付き URL で
// 取った分が混じっているため (docs/stores/audible.md の robots.txt の節)。
// スキーマは書き出さない。本番にはマイグレーションで当てる (README の「本番 D1」)。
// sqlite は読み取り専用で開くので、クロールが書き込み中でも安全

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { findD1SqliteFile } from "./check-migrations.mjs";
import { exportSql, formatCounts } from "./d1-data.mjs";

const D1_STATE_DIR = path.join(".wrangler", "state", "v3", "d1", "miniflare-D1DatabaseObject");
const DEFAULT_EXCLUDED_STORES = ["audible"];

export function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      output: { type: "string" },
      "include-store": { type: "string", multiple: true },
    },
  });

  const sqliteFile = findD1SqliteFile(path.join(process.cwd(), D1_STATE_DIR));
  if (!sqliteFile) {
    console.error("手元の D1 が無い (.wrangler/state)。先に npm run db:migrate:local を実行する");
    return 1;
  }

  const included = values["include-store"] ?? [];
  const excludeStores = DEFAULT_EXCLUDED_STORES.filter((store) => !included.includes(store));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const output = values.output ?? path.join("work", "d1-export", `local-${stamp}.sql`);

  const db = new DatabaseSync(sqliteFile, { readOnly: true });
  try {
    const { sql, counts } = exportSql(db, { excludeStores });
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(output, sql, "utf8");
    console.log(`書き出した: ${output}`);
    if (excludeStores.length > 0) console.log(`除いたストア: ${excludeStores.join(", ")}`);
    console.log(formatCounts(counts));
  } finally {
    db.close();
  }
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exit(main(process.argv.slice(2)));
}
