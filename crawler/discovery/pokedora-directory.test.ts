import { describe, expect, it } from "vitest";
import {
  buildDirectory,
  lookupActor,
  mergeActorRefs,
  type PokedoraActorRefRecord,
} from "./pokedora-directory.ts";
import type { PokedoraTagRecord } from "./pokedora-tags.ts";

const NOW = "2026-09-19T00:00:00.000Z";
const LATER = "2026-09-20T00:00:00.000Z";

function record(
  tagId: number,
  name: string,
  counts: { men: number; bl: number; adt?: number; adtBl?: number },
): PokedoraTagRecord {
  return {
    tagId,
    status: "ok",
    name,
    counts: { men: counts.men, bl: counts.bl, adt: counts.adt ?? 0, "adt-bl": counts.adtBl ?? 0 },
    total: counts.men + counts.bl + (counts.adt ?? 0) + (counts.adtBl ?? 0),
    fetchedAt: NOW,
  };
}

describe("buildDirectory", () => {
  it("正規化した名前で引ける", () => {
    const directory = buildDirectory([record(1920, "小林千晃", { men: 10, bl: 66 })]);
    expect(lookupActor(directory, "小林千晃")).toEqual([
      { externalId: "1920", counts: { men: 10, bl: 66 } },
    ]);
    // 空白の有無は normalizeName が吸収する
    expect(lookupActor(directory, "小林 千晃")).toHaveLength(1);
  });

  it("一般 + BL が 0 件の声優は載せない (引いても必ず 0 件で往復が無駄になる)", () => {
    // オトナ向けに 56 件あっても、取得対象の 2 区分が 0 なら引かない (設計書 §14)
    const directory = buildDirectory([record(1, "佐藤泰臣", { men: 0, bl: 0, adt: 56 })]);
    expect(lookupActor(directory, "佐藤泰臣")).toBeUndefined();
  });

  it("同じ名前に複数の tag_id があれば全部返す (どちらが目当てかは辞書では決まらない)", () => {
    const directory = buildDirectory([
      record(11190, "山崎はるか", { men: 1, bl: 0 }),
      record(65, "山崎はるか", { men: 2, bl: 3 }),
    ]);
    expect(lookupActor(directory, "山崎はるか")?.map((ref) => ref.externalId)).toEqual([
      "11190",
      "65",
    ]);
  });

  it("名前や件数が取れていない記録は捨てる", () => {
    const directory = buildDirectory([
      { tagId: 7, status: "no-name", fetchedAt: NOW },
      { tagId: 8, status: "failed", reason: "HTTP 500", fetchedAt: NOW },
    ]);
    expect(directory.size).toBe(0);
  });

  it("辞書が無いときの lookup は undefined (ポケドラを引かない側に倒す)", () => {
    expect(lookupActor(undefined, "小林千晃")).toBeUndefined();
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
