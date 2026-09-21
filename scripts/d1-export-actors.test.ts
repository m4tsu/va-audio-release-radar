// scripts/d1-export-actors.test.ts
//
// 書き出した SQL を一時 sqlite に流して、行が増えず減らず、別名義の表に触れないことを確かめる。
// ここが壊れると、本番へ流した SQL が声優の行を作ったり消したりする。
// 値が無い列を SET に入れないこと (後から埋めた値を "unknown" で消さないこと) も見る

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { buildActorUpdateSql, main } from "./d1-export-actors.mjs";

const NOW = "2026-09-22T00:00:00.000Z";

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

type Actor = {
  id: string;
  slug: string;
  canonicalName: string;
  nameKana?: string;
  nameEn?: string;
  gender?: string;
};

const ACTORS: Actor[] = [
  {
    id: "va_ueda-reina",
    slug: "ueda-reina",
    canonicalName: "上田麗奈",
    nameKana: "うえだれいな",
    nameEn: "Reina Ueda",
    gender: "female",
  },
  // かなもローマ字も持たず、性別も出どころが持たない。SET する列が 1 つも無い
  { id: "va_nobody", slug: "nobody", canonicalName: "名無し", gender: "unknown" },
  // 名前に引用符が入る。SQL が壊れないことを見る
  {
    id: "va_o-brien",
    slug: "o-brien",
    canonicalName: "オブライエン'",
    nameEn: "Sean O'Brien",
    gender: "male",
  },
];

/** 一時ディレクトリに、書き出しの入力と、流し込み先の sqlite を作る */
function setup(actors: Actor[] = ACTORS) {
  tempDir = mkdtempSync(path.join(tmpdir(), "d1-export-actors-test-"));
  const input = path.join(tempDir, "actors.json");
  const output = path.join(tempDir, "out.sql");
  writeFileSync(input, JSON.stringify(actors), "utf8");

  const db = new DatabaseSync(path.join(tempDir, "db.sqlite"));
  db.exec(`
    CREATE TABLE voice_actors (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      canonical_name TEXT NOT NULL,
      name_kana TEXT,
      name_en TEXT,
      gender TEXT NOT NULL DEFAULT 'unknown',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE voice_actor_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voice_actor_id TEXT NOT NULL REFERENCES voice_actors(id),
      name TEXT NOT NULL
    );
    INSERT INTO voice_actors (id, slug, canonical_name, gender, updated_at) VALUES
      ('va_ueda-reina', 'ueda-reina', '上田麗奈', 'unknown', '2026-01-01T00:00:00.000Z'),
      ('va_o-brien', 'o-brien', 'オブライエン''', 'unknown', '2026-01-01T00:00:00.000Z'),
      ('va_stays', 'stays', '残る人', 'female', '2026-01-01T00:00:00.000Z');
    INSERT INTO voice_actor_aliases (voice_actor_id, name) VALUES ('va_ueda-reina', '上田 麗奈');
  `);

  const messages: string[] = [];
  const deps = {
    input,
    now: NOW,
    log: (message: string) => messages.push(message),
    error: (message: string) => messages.push(message),
  };
  return { input, output, db, messages, deps };
}

describe("buildActorUpdateSql", () => {
  it("UPDATE だけを書き、INSERT や DELETE、別名義の表を含めない", () => {
    const { sql } = buildActorUpdateSql(ACTORS, { now: NOW });
    expect(sql).not.toMatch(/INSERT|DELETE|REPLACE|voice_actor_aliases/i);
    expect(sql.match(/^UPDATE /gm)?.length).toBe(2);
  });

  it("値の無い列を SET に入れず、3 列とも無い声優の文は書かない", () => {
    const { sql, statements, filled, skipped } = buildActorUpdateSql(ACTORS, { now: NOW });
    expect(statements).toBe(2);
    expect(skipped).toBe(1);
    expect(filled).toEqual({ name_kana: 1, name_en: 2, gender: 2 });
    expect(sql).not.toContain("va_nobody");
    expect(sql).not.toContain("'unknown'");
    // ローマ字だけを持つ声優にかなの列は現れない
    const line = sql.split("\n").find((l) => l.includes("va_o-brien")) ?? "";
    expect(line).not.toContain("name_kana");
  });

  it("知らない性別があれば投げる", () => {
    const actors = [{ ...ACTORS[0], gender: "woman" }];
    expect(() => buildActorUpdateSql(actors, { now: NOW })).toThrow("知らない性別");
  });

  it("id の無い声優があれば投げる", () => {
    const actors = [{ slug: "no-id", canonicalName: "x", nameEn: "X" } as unknown as Actor];
    expect(() => buildActorUpdateSql(actors, { now: NOW })).toThrow("id");
  });
});

describe("main", () => {
  it("流しても行が増えず減らず、既に居る声優だけが埋まる", () => {
    const { output, db, deps } = setup();
    expect(main(["--output", output], deps)).toBe(0);

    db.exec(readFileSync(output, "utf8"));
    const rows = db
      .prepare("select id, name_kana, name_en, gender, updated_at from voice_actors order by id")
      .all();
    expect(rows).toEqual([
      {
        id: "va_o-brien",
        name_kana: null,
        name_en: "Sean O'Brien",
        gender: "male",
        updated_at: NOW,
      },
      // リストに無い声優は触られない
      {
        id: "va_stays",
        name_kana: null,
        name_en: null,
        gender: "female",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "va_ueda-reina",
        name_kana: "うえだれいな",
        name_en: "Reina Ueda",
        gender: "female",
        updated_at: NOW,
      },
    ]);
    // 別名義の表は 1 行のまま
    expect(db.prepare("select count(*) as n from voice_actor_aliases").get()).toEqual({ n: 1 });
    db.close();
  });

  it("書かれる行数の見積もりを出す", () => {
    const { output, messages, deps } = setup();
    expect(main(["--output", output], deps)).toBe(0);
    const text = messages.join("\n");
    expect(text).toContain("流し込みで書かれる行数の見積もり");
    expect(text).toMatch(/voice_actors\s+2 行 × \(1 \+ 索引 \d+\)/);
  });

  it("入力が配列でなければ止まる", () => {
    const { output, deps, input } = setup();
    writeFileSync(input, JSON.stringify({ actors: [] }), "utf8");
    const messages: string[] = [];
    expect(
      main(["--output", output], { ...deps, log: (m: string) => messages.push(m), error: (m: string) => messages.push(m) }),
    ).toBe(1);
    expect(messages.join("\n")).toContain("配列でない");
  });
});
