import { describe, expect, test } from "vitest";
import { seasonOrder } from "./types.ts";

describe("seasonOrder", () => {
  test("同じ年では冬 → 春 → 夏 → 秋 の順に大きくなる", () => {
    expect(seasonOrder({ seasonYear: 2026, season: "WINTER" })).toBeLessThan(
      seasonOrder({ seasonYear: 2026, season: "FALL" }),
    );
  });

  test("年をまたぐと、前の年の秋より次の年の冬が大きい", () => {
    expect(seasonOrder({ seasonYear: 2026, season: "FALL" })).toBeLessThan(
      seasonOrder({ seasonYear: 2027, season: "WINTER" }),
    );
  });
});
