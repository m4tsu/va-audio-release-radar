import { describe, expect, it } from "vitest";
import { recentSeasons, seasonLabel, seasonOfDate } from "./anilist.ts";

/**
 * 対象シーズンを実行日から決める規則。
 *
 * 固定の年を書かずに済むかどうかがこの関数の値打ちなので、
 * 基準日を動かしたときに対象がずれることを直接見る
 */

const labels = (baseDate: string, count: number) => recentSeasons(baseDate, count).map(seasonLabel);

describe("seasonOfDate", () => {
  it("月からシーズンを決める", () => {
    expect(seasonOfDate("2026-01-01")).toEqual({ year: 2026, season: "WINTER" });
    expect(seasonOfDate("2026-03-31")).toEqual({ year: 2026, season: "WINTER" });
    expect(seasonOfDate("2026-04-01")).toEqual({ year: 2026, season: "SPRING" });
    expect(seasonOfDate("2026-07-01")).toEqual({ year: 2026, season: "SUMMER" });
    expect(seasonOfDate("2026-10-01")).toEqual({ year: 2026, season: "FALL" });
    expect(seasonOfDate("2026-12-31")).toEqual({ year: 2026, season: "FALL" });
  });

  it("日付として読めない値は断る", () => {
    expect(() => seasonOfDate("いつか")).toThrow();
  });
});

describe("recentSeasons", () => {
  it("次のシーズンを新しい端にして、そこから数えた数だけ古い順に返す", () => {
    // 2026-09-22 は SUMMER。新しい端は次の FALL になる
    expect(labels("2026-09-22", 12)).toEqual([
      "2024 WINTER",
      "2024 SPRING",
      "2024 SUMMER",
      "2024 FALL",
      "2025 WINTER",
      "2025 SPRING",
      "2025 SUMMER",
      "2025 FALL",
      "2026 WINTER",
      "2026 SPRING",
      "2026 SUMMER",
      "2026 FALL",
    ]);
  });

  it("基準日が次の四半期に入ると、対象が 1 つずれる", () => {
    const before = labels("2026-09-30", 12);
    const after = labels("2026-10-01", 12);

    expect(before.at(-1)).toBe("2026 FALL");
    expect(after.at(-1)).toBe("2027 WINTER");
    expect(after[0]).toBe("2024 SPRING");
    // 窓が 1 つ進んでも、重なっている 11 シーズンは同じもの
    expect(after.slice(0, 11)).toEqual(before.slice(1));
  });

  it("年をまたぐときに FALL の次を翌年の WINTER にする", () => {
    expect(labels("2026-12-01", 2)).toEqual(["2026 FALL", "2027 WINTER"]);
  });

  it("1 シーズンだけなら次のシーズンだけを返す", () => {
    expect(labels("2026-09-22", 1)).toEqual(["2026 FALL"]);
  });

  it("0 以下のシーズン数は断る", () => {
    expect(() => recentSeasons("2026-09-22", 0)).toThrow();
    expect(() => recentSeasons("2026-09-22", -1)).toThrow();
  });
});
