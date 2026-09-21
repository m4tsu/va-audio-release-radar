// scripts/d1-export-actors.mjs
//
// 生成済みの声優リスト (`crawler/actors.generated.json`) から、既に D1 に居る声優の
// かな・ローマ字・性別を埋める UPDATE 文を書き出す。
//
//   npm run db:export:actors                        # work/d1-export/actors.sql に書く (毎回上書き)
//   npm run db:export:actors -- --output x.sql
//   npm run db:export:actors -- --input other.json
//
// UPDATE だけを書くので、行は増えず、減らず、別名義の表 (`voice_actor_aliases`) には触れない。
// リストに居て D1 に居ない声優の文は 0 行更新で通り、行を作らない。行を作る経路は取り込み API
// (`src/server/queries/actors.ts` の `upsertActors`) だけに残す。
// 値が無い列は SET に入れない。出どころが値を持たない声優 (gender が "unknown") を
// 「不明」で上書きすると、後から別の出どころで埋めた値まで消えるため。
// 手元の D1 も本番 D1 も読まない。書き出した SQL を流すのは人 (README の「本番 D1」)

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { countIndexesByTable, estimateWriteRows, formatWriteRows, sqlLiteral } from "./d1-data.mjs";
import { readMigrationSql } from "./d1-export-local.mjs";

/** 更新する表。ここ以外の表には触れない */
const TABLE = "voice_actors";

/**
 * 埋める対象の性別。値の正は `src/domain/types.ts` の `VOICE_ACTOR_GENDERS` で、
 * そのうち "unknown" は「出どころが値を持たない」ことを表すので上書きに使わない
 */
const FILLABLE_GENDERS = new Set(["female", "male", "other"]);
const EMPTY_GENDERS = new Set(["unknown", undefined, null, ""]);

/** SET に入れる列と、声優 1 人ぶんの値の取り出し方。並びが SQL の並びになる */
const COLUMNS = [
  { column: "name_kana", pick: (actor) => actor.nameKana },
  { column: "name_en", pick: (actor) => actor.nameEn },
  {
    column: "gender",
    pick: (actor) => {
      const gender = actor.gender;
      if (FILLABLE_GENDERS.has(gender)) return gender;
      // 知らない値を黙って捨てると、列挙が増えたときに気づけないまま流すことになる
      if (!EMPTY_GENDERS.has(gender)) throw new Error(`知らない性別: ${JSON.stringify(gender)}`);
      return undefined;
    },
  },
];

/**
 * 声優リストから UPDATE 文を組み立てる。
 * 返り値の `filled` は列ごとに値を入れた人数、`skipped` は 3 列とも値が無くて文を書かなかった人数
 */
export function buildActorUpdateSql(actors, { now }) {
  const statements = [];
  const filled = Object.fromEntries(COLUMNS.map(({ column }) => [column, 0]));
  let skipped = 0;

  for (const actor of actors) {
    if (typeof actor.id !== "string" || actor.id === "") {
      throw new Error(`id の無い声優がリストにある: ${JSON.stringify(actor.slug ?? actor)}`);
    }
    const assignments = [];
    for (const { column, pick } of COLUMNS) {
      const value = pick(actor);
      if (value === undefined || value === null || value === "") continue;
      assignments.push(`"${column}" = ${sqlLiteral(value)}`);
      filled[column] += 1;
    }
    if (assignments.length === 0) {
      skipped += 1;
      continue;
    }
    // 行の中身が変わるので、取り込み API が upsert でそうするのと同じく更新時刻も進める
    assignments.push(`"updated_at" = ${sqlLiteral(now)}`);
    statements.push(
      `UPDATE "${TABLE}" SET ${assignments.join(", ")} WHERE "id" = ${sqlLiteral(actor.id)};`,
    );
  }

  return { sql: `${statements.join("\n")}\n`, statements: statements.length, filled, skipped };
}

/** `deps` はテストから差し替えるためのもの */
export function main(argv, deps = {}) {
  const {
    input: defaultInput = path.join(process.cwd(), "crawler", "actors.generated.json"),
    migrationsDir = path.join(process.cwd(), "migrations"),
    now = new Date().toISOString(),
    log = console.log,
    error = console.error,
  } = deps;

  const { values } = parseArgs({
    args: argv,
    options: { input: { type: "string" }, output: { type: "string" } },
  });

  const input = values.input ?? defaultInput;
  // 既定は固定名にして上書きする (.claude/rules/docs.md の「work/ の寿命」)
  const output = values.output ?? path.join("work", "d1-export", "actors.sql");

  let actors;
  try {
    actors = JSON.parse(readFileSync(input, "utf8"));
  } catch (cause) {
    error(`声優リストを読めない: ${input} (${cause.message})`);
    return 1;
  }
  if (!Array.isArray(actors)) {
    error(`声優リストが配列でない: ${input}`);
    return 1;
  }

  const { sql, statements, filled, skipped } = buildActorUpdateSql(actors, { now });
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, sql, "utf8");

  log(`書き出した: ${output}`);
  log(`リストの声優 ${actors.length} 人のうち、更新する文を書いた人数: ${statements}`);
  for (const { column } of COLUMNS) log(`  ${column}  ${filled[column]}`);
  if (skipped > 0) log(`3 列とも値が無くて書かなかった人数: ${skipped}`);

  // 流し込みで書かれる行数。見方は npm run db:export:local と同じ (README の「本番 D1」)。
  // slug は更新しないので索引ぶんは実際には書かれない。ここは上限として出す
  const estimate = estimateWriteRows(
    { [TABLE]: statements },
    countIndexesByTable(readMigrationSql(migrationsDir)),
  );
  log("\n流し込みで書かれる行数の見積もり (索引への書き込みを含む)");
  log(formatWriteRows(estimate));
  log("D1 に居ない声優の文は 0 行更新で通るので、実際に書かれる行数はこれを超えない");
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exit(main(process.argv.slice(2)));
}
