// scripts/d1-data.test.ts
//
// 実際のローカル D1 には触れない。一時ディレクトリに作った sqlite に、本番と同じ形の
// 外部キーを持つ小さな表を作ってテストする

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  countSql,
  exportSql,
  isExcludedRow,
  insertTarget,
  isSystemTable,
  listDataTables,
  parseCounts,
  prepareImportSql,
  ROWS_PER_INSERT,
  splitStatements,
  sqlLiteral,
  truncateSql,
} from "./d1-data.mjs";

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

/** 子が親より先に作られる順で表を作り、名前順でも作成順でも FK 順にならないようにする */
const SCHEMA = `
CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE _cf_METADATA (key INTEGER PRIMARY KEY, value BLOB);
CREATE TABLE audio_credits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audio_work_id TEXT NOT NULL REFERENCES audio_works(id),
  voice_actor_id TEXT REFERENCES voice_actors(id),
  credited_name TEXT NOT NULL,
  source_store_slug TEXT NOT NULL
);
CREATE TABLE store_listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audio_work_id TEXT NOT NULL REFERENCES audio_works(id),
  store_slug TEXT NOT NULL,
  title_raw TEXT NOT NULL
);
CREATE TABLE audio_works (id TEXT PRIMARY KEY, title TEXT NOT NULL, price INTEGER);
CREATE TABLE voice_actors (id TEXT PRIMARY KEY, canonical_name TEXT NOT NULL);
CREATE TABLE crawl_runs (id TEXT PRIMARY KEY, store_slug TEXT NOT NULL);
`;

function openDb(): DatabaseSync {
  tempDir = mkdtempSync(path.join(tmpdir(), "d1-data-test-"));
  const db = new DatabaseSync(path.join(tempDir, "test.sqlite"));
  db.exec(SCHEMA);
  return db;
}

function seed(db: DatabaseSync) {
  db.exec(`
    INSERT INTO voice_actors VALUES ('va_a', '上田麗奈');
    INSERT INTO audio_works VALUES ('dlsite:RJ1', 'It''s ASMR', 1584), ('audible:B1', 'Book', NULL);
    INSERT INTO store_listings (audio_work_id, store_slug, title_raw) VALUES
      ('dlsite:RJ1', 'dlsite', 'raw'), ('audible:B1', 'audible', 'raw');
    INSERT INTO audio_credits (audio_work_id, voice_actor_id, credited_name, source_store_slug) VALUES
      ('dlsite:RJ1', 'va_a', '上田麗奈', 'dlsite'), ('audible:B1', NULL, '上田 麗奈', 'audible');
    INSERT INTO crawl_runs VALUES ('r1', 'dlsite'), ('r2', 'audible');
  `);
}

describe("listDataTables", () => {
  it("管理用の表を除き、外部キーの親が先に来る順で返す", () => {
    const db = openDb();
    const tables = listDataTables(db);
    expect(tables).not.toContain("d1_migrations");
    expect(tables).not.toContain("_cf_METADATA");
    expect(tables).not.toContain("sqlite_sequence");
    expect(tables.indexOf("audio_works")).toBeLessThan(tables.indexOf("store_listings"));
    expect(tables.indexOf("audio_works")).toBeLessThan(tables.indexOf("audio_credits"));
    expect(tables.indexOf("voice_actors")).toBeLessThan(tables.indexOf("audio_credits"));
  });
});

describe("sqlLiteral", () => {
  it("文字列の引用符を重ね、NULL と数値をそのまま出す", () => {
    expect(sqlLiteral("It's")).toBe("'It''s'");
    expect(sqlLiteral(null)).toBe("NULL");
    expect(sqlLiteral(undefined)).toBe("NULL");
    expect(sqlLiteral(12)).toBe("12");
    expect(sqlLiteral(1.5)).toBe("1.5");
  });
});

describe("isExcludedRow", () => {
  it("ストアの列と作品 ID の接頭辞で除く", () => {
    expect(isExcludedRow("store_listings", { store_slug: "audible" }, ["audible"])).toBe(true);
    expect(isExcludedRow("audio_credits", { source_store_slug: "dlsite" }, ["audible"])).toBe(false);
    expect(isExcludedRow("audio_works", { id: "audible:B1" }, ["audible"])).toBe(true);
    expect(isExcludedRow("audio_works", { id: "dlsite:RJ1" }, ["audible"])).toBe(false);
    expect(isExcludedRow("voice_actors", { id: "va_a" }, ["audible"])).toBe(false);
    expect(isExcludedRow("store_listings", { store_slug: "audible" }, [])).toBe(false);
  });
});

describe("exportSql", () => {
  it("除いたストアの行を含まず、流し込むと同じ件数に戻る", () => {
    const source = openDb();
    seed(source);
    const { sql, tables, counts } = exportSql(source, { excludeStores: ["audible"] });

    expect(counts).toEqual({
      voice_actors: 1,
      audio_works: 1,
      store_listings: 1,
      audio_credits: 1,
      crawl_runs: 1,
    });
    expect(sql).not.toContain("audible");
    expect(sql).toContain("'It''s ASMR'");

    const target = new DatabaseSync(":memory:");
    target.exec(SCHEMA);
    target.exec("PRAGMA foreign_keys = ON");
    target.exec(sql);
    for (const table of tables) {
      const row = target.prepare(`select count(*) as c from "${table}"`).get() as { c: number };
      expect(row.c).toBe(counts[table]);
    }
  });

  it("行数が多いときは 1 文あたりの行数で分ける", () => {
    const db = openDb();
    const insert = db.prepare("INSERT INTO voice_actors VALUES (?, ?)");
    for (let i = 0; i < ROWS_PER_INSERT + 1; i += 1) insert.run(`va_${i}`, `name ${i}`);
    const { sql } = exportSql(db);
    expect(sql.match(/INSERT INTO "voice_actors"/g)).toHaveLength(2);
  });
});

describe("truncateSql / countSql", () => {
  it("子から順に消し、件数は表ごとに 1 行ずつ返る", () => {
    const db = openDb();
    seed(db);
    const tables = listDataTables(db);
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(truncateSql(tables));
    const counts = parseCounts(db.prepare(countSql(tables)).get() as Record<string, number>);
    expect(Object.keys(counts)).toEqual(tables);
    expect(Object.values(counts).every((count) => count === 0)).toBe(true);
  });
});

describe("isSystemTable", () => {
  it("マイグレーションの記録と sqlite / D1 の内部の表を除く", () => {
    expect(isSystemTable("d1_migrations")).toBe(true);
    expect(isSystemTable("sqlite_sequence")).toBe(true);
    expect(isSystemTable("_cf_METADATA")).toBe(true);
    expect(isSystemTable("_cf_KV")).toBe(true);
    expect(isSystemTable("audio_works")).toBe(false);
  });
});

describe("splitStatements / insertTarget", () => {
  it("引用符の中の ; と重ね書きの引用符で切らない", () => {
    const sql = `INSERT INTO "a" ("t") VALUES ('x; y');\nINSERT INTO b VALUES ('it''s');\nPRAGMA x=1;`;
    const statements = splitStatements(sql);
    expect(statements).toHaveLength(3);
    expect(statements[0]).toBe(`INSERT INTO "a" ("t") VALUES ('x; y')`);
    expect(insertTarget(statements[0])).toBe("a");
    expect(insertTarget(statements[1])).toBe("b");
    expect(insertTarget(statements[2])).toBeUndefined();
  });

  it("コメントの中の ; と引用符で切らず、以降の文を落とさない", () => {
    const sql = [
      "-- it's a comment; with a quote",
      `INSERT INTO "a" ("t") VALUES ('x');`,
      "/* block ; comment with ' quote */",
      `INSERT INTO "b" ("t") VALUES ('y');`,
    ].join("\n");
    const statements = splitStatements(sql);
    expect(statements).toHaveLength(2);
    expect(insertTarget(statements[0])).toBe("a");
    expect(insertTarget(statements[1])).toBe("b");
  });
});

describe("prepareImportSql", () => {
  it("wrangler の書き出しからデータの INSERT だけを残し、親の表から順に並べ直す", () => {
    // wrangler `d1 export --no-schema` の形 (1 行 1 文。表は作成順で子が先。管理用の表の行を含む)
    const dump = [
      "PRAGMA defer_foreign_keys=TRUE;",
      `INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(1,'0000_x.sql','2026-09-18 00:00:00');`,
      `INSERT INTO "audio_credits" ("id","audio_work_id","voice_actor_id","credited_name","source_store_slug") VALUES(1,'dlsite:RJ1','va_a','上田麗奈','dlsite');`,
      `INSERT INTO "audio_works" ("id","title","price") VALUES('dlsite:RJ1',replace('a\\nb','\\n',char(10)),NULL);`,
      `INSERT INTO "voice_actors" ("id","canonical_name") VALUES('va_a','It''s');`,
      `INSERT INTO "sqlite_sequence" ("name","seq") VALUES('audio_credits',1);`,
    ].join("\n");

    const db = openDb();
    const tables = listDataTables(db);
    const prepared = prepareImportSql(dump, tables);
    expect(prepared.statements).toBe(3);
    expect(prepared.dropped).toBe(3);
    expect(prepared.sql).not.toContain("PRAGMA");
    expect(prepared.sql).not.toContain("d1_migrations");
    expect(prepared.sql).not.toContain("sqlite_sequence");
    expect(prepared.sql.indexOf("audio_works")).toBeLessThan(prepared.sql.indexOf("audio_credits"));
    expect(prepared.sql.indexOf("voice_actors")).toBeLessThan(prepared.sql.indexOf("audio_credits"));

    db.exec("PRAGMA foreign_keys = ON");
    db.exec(prepared.sql);
    const title = db.prepare("select title from audio_works").get() as { title: string };
    expect(title.title).toBe("a\nb");
  });

  it("このリポジトリの書き出し (複数行の INSERT) もそのまま通る", () => {
    const source = openDb();
    seed(source);
    const { sql, tables, counts } = exportSql(source);
    const prepared = prepareImportSql(sql, tables);
    const target = new DatabaseSync(":memory:");
    target.exec(SCHEMA);
    target.exec("PRAGMA foreign_keys = ON");
    target.exec(prepared.sql);
    for (const table of tables) {
      const row = target.prepare(`select count(*) as c from "${table}"`).get() as { c: number };
      expect(row.c).toBe(counts[table]);
    }
  });

  it("今のスキーマに無い表への INSERT があれば投げる", () => {
    const db = openDb();
    const tables = listDataTables(db);
    const dump = `INSERT INTO "old_works" ("id") VALUES('x');`;
    expect(() => prepareImportSql(dump, tables)).toThrow("old_works");
  });

  it("表を絞った書き出しは親の順序を保つ", () => {
    const db = openDb();
    seed(db);
    const { tables, counts } = exportSql(db, { onlyTables: ["store_listings", "audio_works"] });
    expect(tables).toEqual(["audio_works", "store_listings"]);
    expect(Object.keys(counts)).toEqual(["audio_works", "store_listings"]);
    expect(() => exportSql(db, { onlyTables: ["nope"] })).toThrow("無い表");
  });
});
