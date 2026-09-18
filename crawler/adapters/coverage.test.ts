import { describe, expect, it } from "vitest";
import { buildCoverage } from "./coverage.ts";

describe("buildCoverage", () => {
  it("総件数ぶん取れていれば complete: true", () => {
    expect(buildCoverage(27, 27, 1)).toEqual({ fetched: 27, total: 27, complete: true, pages: 1 });
  });

  it("総件数に届かなければ complete: false", () => {
    expect(buildCoverage(30, 42, 1)).toEqual({ fetched: 30, total: 42, complete: false, pages: 1 });
  });

  it("総件数を取れなければ total も complete も入れない", () => {
    // 「総件数は分からないが全部取れた」とは言えないので、complete を true にはしない
    expect(buildCoverage(7, undefined, 1)).toEqual({ fetched: 7, pages: 1 });
  });

  it("総件数を上回って取れた場合も complete: true (重複排除後の和集合が上回ることがある)", () => {
    expect(buildCoverage(31, 30, 2)).toEqual({ fetched: 31, total: 30, complete: true, pages: 2 });
  });
});
