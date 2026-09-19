import { describe, expect, test } from "vitest";
import { parseSeasonSlug, seasonLabel, toSeasonSlug } from "./season";

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
