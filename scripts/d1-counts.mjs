// scripts/d1-counts.mjs
//
// 表ごとの件数を出す。本番へ流し込んだ後の照合と、手元との差の確認に使う。
//
//   npm run db:counts -- --local
//   npm run db:counts -- --remote
//
// 表の一覧は D1 自身から読む (wrangler 経由)。手元の sqlite を直接開かないので、
// --remote でも --local でも同じ経路になる

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { countSql, formatCounts, isSystemTable, parseCounts } from "./d1-data.mjs";

function query(target, sql) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "DB", target, "-y", "--json", "--command", sql],
    { encoding: "utf8" },
  );
  return JSON.parse(out)[0].results;
}

export function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: { local: { type: "boolean" }, remote: { type: "boolean" } },
  });
  if (values.local === values.remote) {
    console.error("--local か --remote のどちらか 1 つを指定する");
    return 1;
  }
  const target = values.remote ? "--remote" : "--local";

  const tables = query(target, "select name from sqlite_master where type = 'table' order by name")
    .map((row) => row.name)
    .filter((name) => !isSystemTable(name));
  if (tables.length === 0) {
    console.log("データの表が無い (マイグレーション未適用)");
    return 0;
  }
  console.log(formatCounts(parseCounts(query(target, countSql(tables))[0])));
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exit(main(process.argv.slice(2)));
}
