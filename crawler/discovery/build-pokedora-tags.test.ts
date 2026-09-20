import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildTagEntries, existingEntryCount, toTagEntry } from "./build-pokedora-tags.ts";
import type { PokedoraTagRecord, StoreCounts } from "./pokedora-tags.ts";

const NOW = "2026-09-19T00:00:00.000Z";

function record(
  tagId: number,
  name: string,
  counts: Partial<StoreCounts>,
  overrides: Partial<PokedoraTagRecord> = {},
): PokedoraTagRecord {
  const full: StoreCounts = {
    men: counts.men ?? 0,
    bl: counts.bl ?? 0,
    adt: counts.adt ?? 0,
    "adt-bl": counts["adt-bl"] ?? 0,
  };
  return {
    tagId,
    status: "ok",
    name,
    counts: full,
    total: full.men + full.bl + full.adt + full["adt-bl"],
    httpStatus: 200,
    fetchedAt: NOW,
    ...overrides,
  };
}

describe("toTagEntry", () => {
  it("tag_id・名前・取得対象区分の件数だけを残す", () => {
    expect(toTagEntry(record(1920, "小林千晃", { men: 10, bl: 66, adt: 3 }))).toEqual({
      tagId: 1920,
      name: "小林千晃",
      counts: { men: 10, bl: 66 },
    });
  });

  it("一般 + BL が 0 件なら載せない (オトナ向けに作品があっても引かない)", () => {
    expect(toTagEntry(record(1, "佐藤泰臣", { adt: 56 }))).toBeUndefined();
  });

  it("名前が取れなかった記録は載せない (名前で引けないため)", () => {
    expect(
      toTagEntry({ tagId: 7, status: "no-name", counts: undefined, fetchedAt: NOW }),
    ).toBeUndefined();
  });

  it("取得に失敗した記録は載せない", () => {
    expect(
      toTagEntry({ tagId: 8, status: "failed", reason: "HTTP 500", fetchedAt: NOW }),
    ).toBeUndefined();
  });
});

describe("buildTagEntries", () => {
  it("tag_id の昇順に並べる (差分を人が読めるようにするため)", () => {
    const entries = buildTagEntries([
      record(1920, "小林千晃", { men: 10, bl: 66 }),
      record(65, "山崎はるか", { men: 2, bl: 3 }),
      record(1, "佐藤泰臣", { adt: 56 }),
    ]);
    expect(entries.map((item) => item.tagId)).toEqual([65, 1920]);
  });

  it("同じ tag_id が 2 度あれば先に見たほうだけを残す", () => {
    const entries = buildTagEntries([
      record(65, "山崎はるか", { men: 2, bl: 3 }),
      record(65, "山崎はるか (重複)", { men: 9, bl: 9 }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe("山崎はるか");
  });
});

describe("existingEntryCount", () => {
  it("今ある出力の件数を返す", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "build-pokedora-tags-"));
    const file = path.join(directory, "out.json");
    await writeFile(file, JSON.stringify([{ tagId: 1 }, { tagId: 2 }]), "utf8");
    expect(await existingEntryCount(file)).toBe(2);
  });

  it("出力がまだ無ければ 0 (比べる相手が無いので減りようもない)", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "build-pokedora-tags-"));
    expect(await existingEntryCount(path.join(directory, "none.json"))).toBe(0);
  });

  it("出力があるのに配列として読めなければ undefined (0 件として素通りさせない)", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "build-pokedora-tags-"));
    const broken = path.join(directory, "broken.json");
    await writeFile(broken, "{}", "utf8");
    expect(await existingEntryCount(broken)).toBeUndefined();

    const invalid = path.join(directory, "invalid.json");
    await writeFile(invalid, "[{", "utf8");
    expect(await existingEntryCount(invalid)).toBeUndefined();
  });
});
