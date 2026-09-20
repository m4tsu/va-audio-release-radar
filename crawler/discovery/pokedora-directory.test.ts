import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildDirectory,
  loadPokedoraDirectory,
  lookupActor,
  mergeActorRefs,
  type PokedoraActorRefRecord,
  type PokedoraTagEntry,
  TAGS_GENERATED_JSON,
} from "./pokedora-directory.ts";

const NOW = "2026-09-19T00:00:00.000Z";
const LATER = "2026-09-20T00:00:00.000Z";

function entry(tagId: number, name: string, counts: { men: number; bl: number }): PokedoraTagEntry {
  return { tagId, name, counts };
}

async function dictionaryFile(value: unknown): Promise<string> {
  const file = path.join(await mkdtemp(path.join(tmpdir(), "pokedora-dict-")), "tags.json");
  await writeFile(file, JSON.stringify(value), "utf8");
  return file;
}

describe("buildDirectory", () => {
  it("正規化した名前で引ける", () => {
    const directory = buildDirectory([entry(1920, "小林千晃", { men: 10, bl: 66 })]);
    expect(lookupActor(directory, "小林千晃")).toEqual([
      { externalId: "1920", counts: { men: 10, bl: 66 } },
    ]);
    // 空白の有無は normalizeName が吸収する
    expect(lookupActor(directory, "小林 千晃")).toHaveLength(1);
  });

  it("一般 + BL が 0 件の声優は載せない (引いても必ず 0 件で往復が無駄になる)", () => {
    const directory = buildDirectory([entry(1, "佐藤泰臣", { men: 0, bl: 0 })]);
    expect(lookupActor(directory, "佐藤泰臣")).toBeUndefined();
  });

  it("同じ名前に複数の tag_id があれば全部返す (どちらが目当てかは辞書では決まらない)", () => {
    const directory = buildDirectory([
      entry(11190, "山崎はるか", { men: 1, bl: 0 }),
      entry(65, "山崎はるか", { men: 2, bl: 3 }),
    ]);
    expect(lookupActor(directory, "山崎はるか")?.map((ref) => ref.externalId)).toEqual([
      "11190",
      "65",
    ]);
  });

  it("辞書が無いときの lookup は undefined (ポケドラを引かない側に倒す)", () => {
    expect(lookupActor(undefined, "小林千晃")).toBeUndefined();
  });
});

describe("loadPokedoraDirectory", () => {
  it("ファイルが無ければ undefined (ポケドラだけ飛ばして他ストアは走らせる)", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "pokedora-dict-"));
    expect(await loadPokedoraDirectory(path.join(directory, "none.json"))).toBeUndefined();
  });

  it("配列でなければ undefined", async () => {
    expect(await loadPokedoraDirectory(await dictionaryFile({ records: [] }))).toBeUndefined();
  });

  it("形が違う項目だけ落として残りで引ける", async () => {
    const file = await dictionaryFile([
      { tagId: 7, name: "名前だけ" },
      { tagId: "1920", name: "文字列の tag_id", counts: { men: 1, bl: 0 } },
      { tagId: 8, name: "", counts: { men: 1, bl: 0 } },
      entry(1920, "小林千晃", { men: 10, bl: 66 }),
    ]);
    const directory = await loadPokedoraDirectory(file);
    expect(directory?.size).toBe(1);
    expect(lookupActor(directory, "小林千晃")).toHaveLength(1);
  });
});

/**
 * 配る辞書そのもの。生成元の `.cache/discovery/pokedora-tags.json` はリポジトリに入らないので、
 * 生成物のほうを検証する。ここが崩れるとポケドラが全員分飛ぶ (警告 1 行しか出ない)
 */
describe("pokedora-tags.generated.json", () => {
  async function generatedEntries(): Promise<PokedoraTagEntry[]> {
    return JSON.parse(await readFile(TAGS_GENERATED_JSON, "utf8")) as PokedoraTagEntry[];
  }

  it("tag_id・名前・取得対象区分の件数だけを持ち、tag_id が重複しない", async () => {
    const entries = await generatedEntries();
    expect(entries.length).toBeGreaterThan(1500);
    for (const item of entries) {
      expect(Object.keys(item).sort()).toEqual(["counts", "name", "tagId"]);
      expect(Number.isInteger(item.tagId)).toBe(true);
      expect(item.tagId).toBeGreaterThan(0);
      expect(item.name).not.toBe("");
      expect(item.name).toBe(item.name.trim());
      expect(Object.keys(item.counts).sort()).toEqual(["bl", "men"]);
      // 一般 + BL が 0 件の声優は引かないので、載っていること自体が間違い
      expect(item.counts.men + item.counts.bl).toBeGreaterThan(0);
    }
    expect(new Set(entries.map((item) => item.tagId)).size).toBe(entries.length);
  });

  it("tag_id の昇順に並んでいる (差分を人が読めるようにするため)", async () => {
    const entries = await generatedEntries();
    expect(entries.map((item) => item.tagId)).toEqual(
      [...entries.map((item) => item.tagId)].sort((a, b) => a - b),
    );
  });

  it("配る辞書をそのまま読める", async () => {
    const directory = await loadPokedoraDirectory();
    expect(directory?.size).toBeGreaterThan(1500);
    // 名前から tag_id が引けること。この 1 組が引けなければ対応表の作り方が壊れている
    expect(lookupActor(directory, "小林千晃")?.[0]?.externalId).toBe("1920");
  });
});

describe("mergeActorRefs", () => {
  it("初めて見た tag_id を足す", () => {
    const merged = mergeActorRefs([], [{ externalId: "1920", name: "小林千晃" }], NOW);
    expect(merged).toEqual([
      { tagId: 1920, names: ["小林千晃"], seenCount: 1, firstSeenAt: NOW, lastSeenAt: NOW },
    ]);
  });

  it("同じ tag_id に別の表記が来たら両方残す (別名義 / 表記揺れの根拠になる)", () => {
    const existing: PokedoraActorRefRecord[] = [
      { tagId: 1920, names: ["小林千晃"], seenCount: 1, firstSeenAt: NOW, lastSeenAt: NOW },
    ];
    const merged = mergeActorRefs(existing, [{ externalId: "1920", name: "小林 千晃" }], LATER);
    expect(merged[0]).toEqual({
      tagId: 1920,
      names: ["小林千晃", "小林 千晃"],
      seenCount: 2,
      firstSeenAt: NOW,
      lastSeenAt: LATER,
    });
  });

  it("同じ表記を何度見ても表記は増えず、回数と最終観測だけ動く", () => {
    const existing: PokedoraActorRefRecord[] = [
      { tagId: 1920, names: ["小林千晃"], seenCount: 3, firstSeenAt: NOW, lastSeenAt: NOW },
    ];
    const merged = mergeActorRefs(existing, [{ externalId: "1920", name: "小林千晃" }], LATER);
    expect(merged[0]).toMatchObject({ names: ["小林千晃"], seenCount: 4, lastSeenAt: LATER });
  });

  it("数値として読めない ID は捨てる", () => {
    expect(mergeActorRefs([], [{ externalId: "abc", name: "誰か" }], NOW)).toEqual([]);
  });

  it("tag_id の昇順に並べる (差分を人が読めるようにするため)", () => {
    const merged = mergeActorRefs(
      [],
      [
        { externalId: "1920", name: "小林千晃" },
        { externalId: "84", name: "佐藤拓也" },
      ],
      NOW,
    );
    expect(merged.map((item) => item.tagId)).toEqual([84, 1920]);
  });
});
