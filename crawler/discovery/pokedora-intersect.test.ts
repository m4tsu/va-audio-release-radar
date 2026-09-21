import { describe, expect, it } from "vitest";
import type { StaffRecord } from "./anilist.ts";
import type { DlsiteWorkRecord } from "./intersect.ts";
import {
  dlsiteVoiceNames,
  groupByNormalizedName,
  intersect,
  type PokedoraActor,
  toActors,
} from "./pokedora-intersect.ts";
import type { PokedoraTagRecord } from "./pokedora-tags.ts";

const AT = "2026-09-18T00:00:00.000Z";

function tagRecord(
  tagId: number,
  name: string | undefined,
  counts?: { men: number; bl: number; adt: number; "adt-bl": number },
): PokedoraTagRecord {
  if (name === undefined) return { tagId, status: "no-name", fetchedAt: AT };
  return {
    tagId,
    status: "ok",
    name,
    ...(counts === undefined
      ? {}
      : { counts, total: counts.men + counts.bl + counts.adt + counts["adt-bl"] }),
    fetchedAt: AT,
  };
}

function staff(anilistStaffId: number, nativeName: string, roleCount = 10): StaffRecord {
  return {
    anilistStaffId,
    nativeName,
    gender: "unknown",
    roleCount,
    mainRoleCount: 1,
    latestSeason: "2026 FALL",
    mediaCount: 5,
    ambiguous: false,
  };
}

describe("toActors", () => {
  it("名前が取れた記録だけを声優にする", () => {
    const actors = toActors([
      tagRecord(1, "小林千晃", { men: 10, bl: 66, adt: 0, "adt-bl": 0 }),
      tagRecord(2, undefined),
      { tagId: 3, status: "failed", httpStatus: 404, reason: "x", fetchedAt: AT },
    ]);
    expect(actors).toHaveLength(1);
    expect(actors[0]?.name).toBe("小林千晃");
  });

  it("取得対象はオトナ向けを含まない一般 + BL の合計", () => {
    const actors = toActors([tagRecord(1, "甲", { men: 3, bl: 4, adt: 100, "adt-bl": 200 })]);
    expect(actors[0]?.target).toBe(7);
    expect(actors[0]?.adt).toBe(100);
  });

  it("件数が取れなかった記録は 0 件として扱う", () => {
    const actors = toActors([tagRecord(1, "甲")]);
    expect(actors[0]?.target).toBe(0);
  });
});

describe("groupByNormalizedName", () => {
  it("表記が違うだけの名前を同じ組にまとめる", () => {
    const actors = toActors([
      tagRecord(1, "小林千晃", { men: 1, bl: 0, adt: 0, "adt-bl": 0 }),
      tagRecord(2, "小林 千晃", { men: 2, bl: 0, adt: 0, "adt-bl": 0 }),
    ]);
    const grouped = groupByNormalizedName(actors);
    expect(grouped.size).toBe(1);
    expect([...grouped.values()][0]).toHaveLength(2);
  });
});

describe("dlsiteVoiceNames", () => {
  it("voice_by を正規化して集める", () => {
    const works = [
      { workno: "RJ1", voiceNames: ["小林 千晃", "上田麗奈"] },
      { workno: "RJ2", voiceNames: [] },
    ] as unknown as DlsiteWorkRecord[];
    const names = dlsiteVoiceNames(works);
    expect(names.has("小林千晃")).toBe(true);
    expect(names.has("上田麗奈")).toBe(true);
    expect(names.size).toBe(2);
  });
});

describe("intersect", () => {
  const actors = toActors([
    tagRecord(1, "小林千晃", { men: 10, bl: 66, adt: 1, "adt-bl": 2 }),
    tagRecord(2, "上田麗奈", { men: 5, bl: 0, adt: 0, "adt-bl": 0 }),
    tagRecord(3, "架空太郎", { men: 3, bl: 1, adt: 0, "adt-bl": 0 }),
  ]);

  const result = intersect({
    actors,
    staff: [staff(1, "小林千晃", 40), staff(2, "上田 麗奈", 30)],
    dlsiteNames: new Set(["小林千晃"]),
    audibleByName: new Map([["上田麗奈", true]]),
  });

  it("AniList に名前がある人だけを交差に入れる", () => {
    expect(result.rows.map((row) => row.name)).toEqual(["小林千晃", "上田麗奈"]);
  });

  it("AniList 側の表記揺れを越えて一致させる", () => {
    expect(result.rows.find((row) => row.name === "上田麗奈")?.anilistStaffId).toBe(2);
  });

  it("AniList に無い名前はポケドラのみに分ける", () => {
    expect(result.pokedoraOnly.map((actor) => actor.name)).toEqual(["架空太郎"]);
  });

  it("取得対象の多い順に並べる", () => {
    expect(result.rows[0]?.target).toBe(76);
  });

  it("オトナ向けは取得対象に入れず参考値として分ける", () => {
    const row = result.rows.find((r) => r.name === "小林千晃");
    expect(row?.target).toBe(76);
    expect(row?.adtTotal).toBe(3);
  });

  it("DLsite に無い人を × に、Audible の未調査を unknown にする", () => {
    const kobayashi = result.rows.find((row) => row.name === "小林千晃");
    const ueda = result.rows.find((row) => row.name === "上田麗奈");
    expect(kobayashi?.dlsite).toBe(true);
    expect(kobayashi?.audible).toBe("unknown");
    expect(ueda?.dlsite).toBe(false);
    expect(ueda?.audible).toBe("yes");
  });

  it("同じ名前に複数の tag_id が付いていたら件数を合算し、曖昧として記録する", () => {
    const duplicated = intersect({
      actors: toActors([
        tagRecord(10, "甲野乙", { men: 3, bl: 0, adt: 0, "adt-bl": 0 }),
        tagRecord(11, "甲野乙", { men: 1, bl: 2, adt: 0, "adt-bl": 0 }),
      ]),
      staff: [staff(1, "甲野乙")],
      dlsiteNames: new Set<string>(),
      audibleByName: new Map<string, boolean>(),
    });
    expect(duplicated.rows).toHaveLength(1);
    expect(duplicated.rows[0]?.tagIds).toEqual([10, 11]);
    expect(duplicated.rows[0]?.target).toBe(6);
    expect(duplicated.duplicateNames).toHaveLength(1);
  });

  it("ポケドラにしか居ない同名タグも 1 人にまとめる", () => {
    const only = intersect({
      actors: toActors([
        tagRecord(20, "丙野丁", { men: 3, bl: 0, adt: 0, "adt-bl": 0 }),
        tagRecord(21, "丙野丁", { men: 4, bl: 0, adt: 0, "adt-bl": 0 }),
      ]),
      staff: [],
      dlsiteNames: new Set<string>(),
      audibleByName: new Map<string, boolean>(),
    });
    expect(only.pokedoraOnly).toHaveLength(1);
    expect(only.pokedoraOnly[0]?.target).toBe(7);
  });

  it("AniList に同名が複数居るときは出演の多いほうを代表にする", () => {
    const ambiguous = intersect({
      actors: toActors([tagRecord(30, "同名太郎", { men: 1, bl: 0, adt: 0, "adt-bl": 0 })]),
      staff: [
        { ...staff(100, "同名太郎", 3), ambiguous: true },
        { ...staff(200, "同名太郎", 9), ambiguous: true },
      ],
      dlsiteNames: new Set<string>(),
      audibleByName: new Map<string, boolean>(),
    });
    expect(ambiguous.rows[0]?.anilistStaffId).toBe(200);
    expect(ambiguous.rows[0]?.anilistAmbiguous).toBe(true);
  });
});

describe("PokedoraActor の型", () => {
  it("正規化した名前を持つ", () => {
    const actor: PokedoraActor | undefined = toActors([tagRecord(1, "小林 千晃")])[0];
    expect(actor?.normalized).toBe("小林千晃");
  });
});

describe("intersect の異体字", () => {
  /**
   * 突き合わせの鍵は `normalizeName` だけで、そこに人名の異体字の変換表が入った
   * 。字体が割れている人が交差に入ることをこの層でも固定する
   */
  it("字体が割れていても交差に入れる", () => {
    const result = intersect({
      actors: toActors([
        tagRecord(1, "天﨑滉平", { men: 8, bl: 27, adt: 0, "adt-bl": 0 }),
        tagRecord(2, "髙木俊", { men: 1, bl: 0, adt: 0, "adt-bl": 0 }),
      ]),
      staff: [staff(1, "天崎滉平"), staff(2, "高木俊")],
      dlsiteNames: new Set(),
      audibleByName: new Map(),
    });

    expect(result.rows.map((row) => row.anilistStaffId)).toEqual([1, 2]);
    expect(result.pokedoraOnly).toEqual([]);
  });

  it("別人までは同一視しない", () => {
    const result = intersect({
      actors: toActors([tagRecord(1, "新田杏樹", { men: 1, bl: 0, adt: 0, "adt-bl": 0 })]),
      staff: [staff(1, "小田杏樹")],
      dlsiteNames: new Set(),
      audibleByName: new Map(),
    });

    expect(result.rows).toEqual([]);
    expect(result.pokedoraOnly.map((actor) => actor.name)).toEqual(["新田杏樹"]);
  });
});
