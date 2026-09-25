import { describe, expect, test } from "vitest";
import {
  adjacentSeasons,
  featuredSeason,
  parseSeasonSlug,
  seasonLabel,
  toSeasonSlug,
} from "./season";

describe("seasonLabel", () => {
  test("日本語は「年」が先、英語は季節が先になる", () => {
    expect(seasonLabel(2026, "FALL")).toBe("2026 年秋");
    expect(seasonLabel(2026, "FALL", "en")).toBe("Fall 2026");
    expect(seasonLabel(2027, "WINTER", "en")).toBe("Winter 2027");
  });
});

describe("toSeasonSlug / parseSeasonSlug", () => {
  /** URL は言語で変わらない。言語は cookie で決まり URL には出さない */
  test("slug は言語に関わらず同じ", () => {
    expect(toSeasonSlug(2026, "FALL")).toBe("2026-fall");
    expect(parseSeasonSlug("2026-fall")).toEqual({ seasonYear: 2026, season: "FALL" });
  });

  test("読めない slug は undefined", () => {
    expect(parseSeasonSlug("2026-autumn")).toBeUndefined();
    expect(parseSeasonSlug("fall")).toBeUndefined();
  });
});

describe("adjacentSeasons", () => {
  /** 間が空いていても「次の年度」を作らない。作品があるシーズンだけを隣とする */
  const SEASONS = [
    { seasonYear: 2026, season: "FALL" },
    { seasonYear: 2026, season: "SPRING" },
    { seasonYear: 2024, season: "WINTER" },
  ] as const;

  test("並びの間にあるシーズンは前後の両方を返す", () => {
    expect(adjacentSeasons(SEASONS, { seasonYear: 2026, season: "SPRING" })).toEqual({
      older: { seasonYear: 2024, season: "WINTER" },
      newer: { seasonYear: 2026, season: "FALL" },
    });
  });

  test("いちばん新しいシーズンには次が無い", () => {
    expect(adjacentSeasons(SEASONS, { seasonYear: 2026, season: "FALL" })).toEqual({
      older: { seasonYear: 2026, season: "SPRING" },
    });
  });

  test("いちばん古いシーズンには前が無い", () => {
    expect(adjacentSeasons(SEASONS, { seasonYear: 2024, season: "WINTER" })).toEqual({
      newer: { seasonYear: 2026, season: "SPRING" },
    });
  });

  /** 一覧に無いシーズン (作品が 1 件も無い期) を直に開いたとき */
  test("並びに無いシーズンでは前後を出さない", () => {
    expect(adjacentSeasons(SEASONS, { seasonYear: 2025, season: "SUMMER" })).toEqual({});
  });
});

describe("featuredSeason", () => {
  const SEASONS = [
    { seasonYear: 2026, season: "FALL" },
    { seasonYear: 2026, season: "SUMMER" },
    { seasonYear: 2024, season: "WINTER" },
  ] as const;

  test("放送中のシーズンに作品があればそのシーズンを出す", () => {
    expect(featuredSeason(SEASONS, new Date("2026-08-01T00:00:00Z"))).toEqual({
      seasonYear: 2026,
      season: "SUMMER",
    });
  });

  test("放送中のシーズンに作品が無ければ、古い方向でいちばん新しいシーズンを出す", () => {
    // 2026 年春に作品は無いので 2024 年冬まで戻る
    expect(featuredSeason(SEASONS, new Date("2026-05-01T00:00:00Z"))).toEqual({
      seasonYear: 2024,
      season: "WINTER",
    });
  });

  /** 持っているのが放送前のシーズンだけのとき。空の画面を出すより、いちばん古いシーズンを出す */
  test("古い方向に無ければ、いちばん古いシーズンを出す", () => {
    expect(featuredSeason(SEASONS, new Date("2023-05-01T00:00:00Z"))).toEqual({
      seasonYear: 2024,
      season: "WINTER",
    });
  });

  test("いちばん新しいシーズンより後なら、そのシーズンを出す", () => {
    expect(featuredSeason(SEASONS, new Date("2030-01-01T00:00:00Z"))).toEqual({
      seasonYear: 2026,
      season: "FALL",
    });
  });

  test("シーズンが 1 つも無ければ undefined", () => {
    expect(featuredSeason([], new Date("2026-08-01T00:00:00Z"))).toBeUndefined();
  });

  /** 作品数のような余分な列を持つ一覧をそのまま渡せる */
  test("年とシーズンだけを返す", () => {
    const entries = [{ seasonYear: 2026, season: "SUMMER", animeCount: 3 }] as const;
    expect(featuredSeason(entries, new Date("2026-08-01T00:00:00Z"))).toEqual({
      seasonYear: 2026,
      season: "SUMMER",
    });
  });
});
