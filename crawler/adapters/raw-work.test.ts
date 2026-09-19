import { describe, expect, it } from "vitest";
import type { RawWork } from "../../src/domain/index.ts";
import { validateRawWorks } from "./raw-work.ts";

const VALID: RawWork = {
  storeSlug: "dlsite",
  storeProductId: "RJ01698658",
  titleRaw: "テスト作品",
  productUrl: "https://www.dlsite.com/home/work/=/product_id/RJ01698658.html",
  creditedNames: ["上田麗奈"],
  ageRating: "general",
  fetchedAt: "2026-09-18T00:00:00.000Z",
};

describe("validateRawWorks", () => {
  it("検証を通った作品だけを返す", () => {
    const result = validateRawWorks([VALID]);
    expect(result.works).toEqual([VALID]);
    expect(result.invalidCount).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  it("壊れた作品は捨て、件数と理由を残す", () => {
    // 1 作品の崩れで 30 件まるごと失わないよう、例外にせず除外する
    const result = validateRawWorks([VALID, { ...VALID, price: "1584" }, null]);
    expect(result.works).toEqual([VALID]);
    expect(result.invalidCount).toBe(2);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toContain("RJ01698658");
    expect(result.warnings[0]).toContain("price");
  });
});
