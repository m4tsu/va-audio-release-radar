import { describe, expect, it } from "vitest";
import {
  aggregateStaff,
  describeGraphqlErrors,
  enumerateSeasons,
  parseSeasonPage,
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
   * AniList の実データと同じ形。`node` を選ばないと voiceActors が null で返るので、
   * 応答には node が入っている前提で解析する
   */
  const json = {
    data: {
      Page: {
        pageInfo: { hasNextPage: true },
        media: [
          {
            id: 178789,
            title: { native: "無職転生Ⅲ" },
            characters: {
              edges: [
                {
                  role: "MAIN",
                  node: { id: 88348 },
                  voiceActors: [
                    { id: 106784, name: { native: "内山夕実", full: "Yumi Uchiyama" } },
                    { id: 95002, name: { native: "杉田智和", full: "Tomokazu Sugita" } },
                  ],
                },
                {
                  role: "SUPPORTING",
                  node: { id: 88346 },
                  voiceActors: [{ id: 105765, name: { native: "茅野愛衣", full: "Ai Kayano" } }],
                },
                { role: "SUPPORTING", node: { id: 1 }, voiceActors: [] },
                { role: "BACKGROUND", node: { id: 2 }, voiceActors: null },
              ],
            },
          },
          { id: 196187, title: { native: null }, characters: { edges: [] } },
          { title: { native: "id が無いので捨てる" } },
        ],
      },
    },
  };

  it("作品の id と題を取る", () => {
    expect(parseSeasonPage(json).media).toEqual([
      { id: 178789, titleNative: "無職転生Ⅲ" },
      { id: 196187 },
    ]);
  });

  it("1 キャラクターに複数の声優が居ても全員取る", () => {
    const credits = parseSeasonPage(json).credits;
    expect(credits).toHaveLength(3);
    expect(credits[0]).toEqual({
      mediaId: 178789,
      staffId: 106784,
      nativeName: "内山夕実",
      fullName: "Yumi Uchiyama",
      role: "MAIN",
    });
  });

  it("voiceActors が null か空のキャラクターは飛ばす", () => {
    expect(parseSeasonPage(json).credits.map((credit) => credit.role)).toEqual([
      "MAIN",
      "MAIN",
      "SUPPORTING",
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
      nativeName: "上田麗奈",
      fullName: "Reina Ueda",
      role: "MAIN",
      season: { year: 2024, season: "WINTER" },
    },
    {
      mediaId: 2,
      staffId: 10,
      nativeName: "上田麗奈",
      fullName: "Reina Ueda",
      role: "SUPPORTING",
      season: { year: 2026, season: "SUMMER" },
    },
    {
      mediaId: 2,
      staffId: 10,
      nativeName: "上田麗奈",
      fullName: "Reina Ueda",
      role: "MAIN",
      season: { year: 2026, season: "SUMMER" },
    },
    {
      mediaId: 3,
      staffId: 20,
      nativeName: "佐藤健",
      role: "MAIN",
      season: { year: 2025, season: "FALL" },
    },
    {
      mediaId: 4,
      staffId: 21,
      nativeName: "佐藤健",
      role: "SUPPORTING",
      season: { year: 2024, season: "SPRING" },
    },
    { mediaId: 5, staffId: 30, role: "MAIN", season: { year: 2026, season: "FALL" } },
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
