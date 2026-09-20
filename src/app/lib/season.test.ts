import { describe, expect, test } from "vitest";
import { adjacentSeasons, parseSeasonSlug, seasonLabel, toSeasonSlug } from "./season";

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
