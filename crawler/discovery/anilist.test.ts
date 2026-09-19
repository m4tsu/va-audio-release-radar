import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES_DIR } from "../lib/paths.ts";
import {
  aggregateStaff,
  describeGraphqlErrors,
  enumerateSeasons,
  parseSeasonPage,
  queryFingerprint,
  SEASON_PAGE_QUERY,
  type SeasonCredit,
  seasonOrder,
} from "./anilist.ts";

describe("enumerateSeasons", () => {
  it("年をまたいで古い順に並べる", () => {
    const seasons = enumerateSeasons(
      { year: 2024, season: "WINTER" },
      { year: 2026, season: "FALL" },
    );
    expect(seasons).toHaveLength(12);
    expect(seasons[0]).toEqual({ year: 2024, season: "WINTER" });
    expect(seasons[4]).toEqual({ year: 2025, season: "WINTER" });
    expect(seasons[11]).toEqual({ year: 2026, season: "FALL" });
  });

  it("開始が終了より後なら空", () => {
    expect(
      enumerateSeasons({ year: 2026, season: "FALL" }, { year: 2024, season: "WINTER" }),
    ).toEqual([]);
  });
});

describe("seasonOrder", () => {
  it("年内の並びが WINTER → FALL になる", () => {
    expect(seasonOrder({ year: 2026, season: "FALL" })).toBeGreaterThan(
      seasonOrder({ year: 2026, season: "WINTER" }),
    );
    expect(seasonOrder({ year: 2026, season: "WINTER" })).toBeGreaterThan(
      seasonOrder({ year: 2025, season: "FALL" }),
    );
  });
});

describe("parseSeasonPage", () => {
  /**
   * 実応答と同じ形の固定 JSON。`node` を選ばないと voiceActors が null で返るので、
   * 応答には node が入っている前提で解析する
   */
  const json: unknown = JSON.parse(
    readFileSync(path.join(FIXTURES_DIR, "anilist-season-page.json"), "utf8"),
  );

  it("作品の id と題とカバー画像を取る", () => {
    expect(parseSeasonPage(json).media).toEqual([
      {
        id: 195516,
        titleNative: "薬屋のひとりごと 第3期",
        titleRomaji: "Kusuriya no Hitorigoto 3rd Season",
        titleEnglish: "The Apothecary Diaries Season 3",
        coverImageUrl:
          "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx195516-hSRLGkNlPNJI.jpg",
      },
      {
        id: 160275,
        titleNative: "メイドインアビス 目覚める神秘",
        titleRomaji: "Made in Abyss: Mezameru Shinpi",
        coverImageUrl:
          "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx160275-Qk1cZ6hFJmSE.jpg",
      },
      { id: 196187 },
    ]);
  });

  it("キャラクターと声優を 1 件ずつの credit にする", () => {
    const credits = parseSeasonPage(json).credits;
    expect(credits).toHaveLength(6);
    expect(credits[0]).toEqual({
      mediaId: 195516,
      staffId: 128426,
      characterId: 127278,
      nativeName: "大塚剛央",
      fullName: "Takeo Ootsuka",
      characterNameNative: "壬氏",
      characterNameFull: "Jinshi",
      characterImageUrl:
        "https://s4.anilist.co/file/anilistcdn/character/medium/b127278-2Yp2Zv1qXk0n.png",
      actorImageUrl: "https://s4.anilist.co/file/anilistcdn/staff/medium/n128426-3yOZ6Mkt0YQe.png",
      role: "MAIN",
    });
  });

  it("名前や画像が null のキャラクターでも credit は作る", () => {
    const credit = parseSeasonPage(json).credits.find((item) => item.staffId === 118602);
    expect(credit).toEqual({
      mediaId: 195516,
      staffId: 118602,
      characterId: 406588,
      nativeName: "上田麗奈",
      fullName: "Reina Ueda",
      role: "SUPPORTING",
    });
  });

  it("1 キャラクターに複数の声優が居ても全員取る", () => {
    const credits = parseSeasonPage(json).credits.filter((item) => item.characterId === 122444);
    expect(credits.map((item) => item.staffId)).toEqual([95655, 119518]);
  });

  it("voiceActors が null か空、または node が無いキャラクターは飛ばす", () => {
    expect(parseSeasonPage(json).credits.map((credit) => credit.role)).toEqual([
      "MAIN",
      "MAIN",
      "SUPPORTING",
      "BACKGROUND",
      "MAIN",
      "MAIN",
    ]);
  });

  it("次ページの有無を返す", () => {
    expect(parseSeasonPage(json).hasNextPage).toBe(true);
  });

  it("想定外の形でも落ちない", () => {
    expect(parseSeasonPage(undefined)).toEqual({ media: [], credits: [], hasNextPage: false });
    expect(parseSeasonPage({ data: { Page: null } })).toEqual({
      media: [],
      credits: [],
      hasNextPage: false,
    });
  });
});

describe("describeGraphqlErrors", () => {
  it("errors があれば 1 行にまとめる", () => {
    expect(describeGraphqlErrors({ errors: [{ message: "Too Many Requests" }] })).toBe(
      "Too Many Requests",
    );
    expect(describeGraphqlErrors({ data: {} })).toBeUndefined();
  });
});

describe("aggregateStaff", () => {
  const credits: SeasonCredit[] = [
    {
      mediaId: 1,
      staffId: 10,
      characterId: 101,
      nativeName: "上田麗奈",
      fullName: "Reina Ueda",
      role: "MAIN",
      season: { year: 2024, season: "WINTER" },
    },
    {
      mediaId: 2,
      staffId: 10,
      characterId: 102,
      nativeName: "上田麗奈",
      fullName: "Reina Ueda",
      role: "SUPPORTING",
      season: { year: 2026, season: "SUMMER" },
    },
    {
      mediaId: 2,
      staffId: 10,
      characterId: 103,
      nativeName: "上田麗奈",
      fullName: "Reina Ueda",
      role: "MAIN",
      season: { year: 2026, season: "SUMMER" },
    },
    {
      mediaId: 3,
      staffId: 20,
      characterId: 104,
      nativeName: "佐藤健",
      role: "MAIN",
      season: { year: 2025, season: "FALL" },
    },
    {
      mediaId: 4,
      staffId: 21,
      characterId: 105,
      nativeName: "佐藤健",
      role: "SUPPORTING",
      season: { year: 2024, season: "SPRING" },
    },
    {
      mediaId: 5,
      staffId: 30,
      characterId: 106,
      role: "MAIN",
      season: { year: 2026, season: "FALL" },
    },
  ];

  it("役数・主役数・作品数・最新シーズンを集計する", () => {
    const { staff } = aggregateStaff(credits);
    const ueda = staff.find((person) => person.anilistStaffId === 10);
    expect(ueda).toMatchObject({
      nativeName: "上田麗奈",
      roleCount: 3,
      mainRoleCount: 2,
      mediaCount: 2,
      latestSeason: "2026 SUMMER",
      ambiguous: false,
    });
  });

  it("同じ nativeName を別の staff が持っていたら ambiguous を立てる", () => {
    const { staff } = aggregateStaff(credits);
    const sato = staff.filter((person) => person.nativeName === "佐藤健");
    expect(sato).toHaveLength(2);
    expect(sato.every((person) => person.ambiguous)).toBe(true);
  });

  it("nativeName が無い staff は突き合わせ不能として除外し、数だけ残す", () => {
    const { staff, withoutNativeName } = aggregateStaff(credits);
    expect(withoutNativeName).toBe(1);
    expect(staff.some((person) => person.anilistStaffId === 30)).toBe(false);
  });

  it("roleCount の多い順に並ぶ", () => {
    const { staff } = aggregateStaff(credits);
    expect(staff[0]?.anilistStaffId).toBe(10);
  });
});

describe("queryFingerprint", () => {
  it("同じクエリなら同じ指紋", () => {
    expect(queryFingerprint(SEASON_PAGE_QUERY)).toBe(queryFingerprint(SEASON_PAGE_QUERY));
  });

  it("取得項目を 1 つ足すだけで指紋が変わる", () => {
    // 鍵にこれを混ぜないと、クエリを変えても古いスナップショットが返る (2026-09-18 に実際に踏んだ)
    const changed = SEASON_PAGE_QUERY.replace(
      "title { native romaji english }",
      "title { native }",
    );
    expect(queryFingerprint(changed)).not.toBe(queryFingerprint(SEASON_PAGE_QUERY));
  });
});
