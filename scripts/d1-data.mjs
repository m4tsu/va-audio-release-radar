// scripts/d1-data.mjs
//
// 本番 D1 と手元の D1 の間でデータを移すための純粋な部品。
// - 表の一覧と、外部キーの親から順に並べた順序 (流し込みが FK 違反で止まらないため)
// - 表の中身を INSERT 文に書き出す (Audible のように移さないストアの行を除ける)
// - 全表を空にする DELETE 文と、件数照合の SELECT 文
//
// wrangler の `d1 export` を使わないのは、行の除外と表の順序を制御できないため。
// ここは sqlite を読むだけで、書き込みはすべて wrangler 経由で行う (d1-restore-local.mjs)。
// 依存追加はしない。Node 24 標準の node:sqlite を使う。

/**
 * 移す対象にしない表。マイグレーションの記録と、sqlite / miniflare / D1 の管理用。
 * D1 は `_cf_` で始まる表を内部で持ち (手元は `_cf_METADATA`、本番は `_cf_KV`)、SELECT できない
 */
export function isSystemTable(name) {
  return name === "d1_migrations" || name.startsWith("sqlite_") || name.startsWith("_cf_");
}

/** 1 つの INSERT 文に入れる行数。D1 の 1 文あたりの長さ上限に余裕を持たせる */
export const ROWS_PER_INSERT = 50;

/**
 * データの表を、外部キーの親が先に来る順で返す。
 * 同じ深さの表は名前順にして、出力を決定的にする
 */
export function listDataTables(db) {
  const names = db
    .prepare("select name from sqlite_master where type = 'table' order by name")
    .all()
    .map((row) => row.name)
    .filter((name) => !isSystemTable(name));

  const parents = new Map();
  for (const name of names) {
    const refs = db
      .prepare(`pragma foreign_key_list("${name}")`)
      .all()
      .map((row) => row.table)
      .filter((parent) => parent !== name && names.includes(parent));
    parents.set(name, new Set(refs));
  }

  const ordered = [];
  const done = new Set();
  while (ordered.length < names.length) {
    const ready = names.filter(
      (name) => !done.has(name) && [...parents.get(name)].every((parent) => done.has(parent)),
    );
    if (ready.length === 0) {
      throw new Error(`外部キーが循環している: ${names.filter((name) => !done.has(name)).join(", ")}`);
    }
    for (const name of ready) {
      ordered.push(name);
      done.add(name);
    }
  }
  return ordered;
}

export function listColumns(db, table) {
  return db
    .prepare(`pragma table_info("${table}")`)
    .all()
    .map((row) => row.name);
}

/** SQL の値リテラル。文字列は '' で引用符を重ね、それ以外は数値か NULL */
export function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return `'${value.replaceAll("'", "''")}'`;
  if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString("hex")}'`;
  throw new Error(`SQL に書けない値: ${typeof value}`);
}

/**
 * この行を移さないか。ストアを除くときの規則:
 * - `store_slug` / `source_store_slug` の列がそのストアなら除く
 * - 作品 ID は "{store}:{id}" の形 (src/server/queries/ingest.ts の buildWorkId) なので、
 *   `audio_works` は id の接頭辞で除く
 */
export function isExcludedRow(table, row, excludeStores) {
  if (excludeStores.length === 0) return false;
  for (const column of ["store_slug", "source_store_slug"]) {
    if (column in row && excludeStores.includes(row[column])) return true;
  }
  if (table === "audio_works" && typeof row.id === "string") {
    return excludeStores.some((store) => row.id.startsWith(`${store}:`));
  }
  return false;
}

/**
 * 全データ表の中身を INSERT 文にして返す。表は外部キーの親から順。
 * 返り値の `counts` は表ごとの書き出した行数で、流し込んだ後の件数照合に使う
 */
export function exportSql(db, { excludeStores = [] } = {}) {
  const tables = listDataTables(db);
  const lines = [];
  const counts = {};

  for (const table of tables) {
    const columns = listColumns(db, table);
    const rows = db.prepare(`select * from "${table}"`).all();
    const kept = rows.filter((row) => !isExcludedRow(table, row, excludeStores));
    counts[table] = kept.length;
    if (kept.length === 0) continue;

    const columnList = columns.map((column) => `"${column}"`).join(", ");
    for (let start = 0; start < kept.length; start += ROWS_PER_INSERT) {
      const values = kept
        .slice(start, start + ROWS_PER_INSERT)
        .map((row) => `(${columns.map((column) => sqlLiteral(row[column])).join(", ")})`)
        .join(",\n");
      lines.push(`INSERT INTO "${table}" (${columnList}) VALUES\n${values};`);
    }
  }
  return { sql: `${lines.join("\n")}\n`, tables, counts };
}

/** 全データ表を空にする。子から順に消して外部キー違反を避ける */
export function truncateSql(tables) {
  return [...tables]
    .reverse()
    .map((table) => `DELETE FROM "${table}";`)
    .join("\n");
}

/**
 * 表ごとの件数を 1 行で返す SELECT。列名が表名。
 * UNION ALL で縦に並べる形にしないのは、D1 が compound SELECT の項数を小さく制限しているため
 */
export function countSql(tables) {
  const columns = tables.map((table) => `(SELECT count(*) FROM "${table}") AS "${table}"`);
  return `SELECT ${columns.join(", ")}`;
}

/** `countSql` の結果の 1 行を { 表名: 件数 } にする */
export function parseCounts(row) {
  return Object.fromEntries(Object.entries(row).map(([table, count]) => [table, Number(count)]));
}

/** 件数を表にして人が読める形にする */
export function formatCounts(counts) {
  const width = Math.max(...Object.keys(counts).map((name) => name.length));
  return Object.entries(counts)
    .map(([table, count]) => `${table.padEnd(width)}  ${String(count).padStart(7)}`)
    .join("\n");
}
