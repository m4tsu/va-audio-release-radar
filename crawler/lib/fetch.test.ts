import { describe, expect, it } from "vitest";
import { rateLimitFor } from "./fetch.ts";
import { safeFileName } from "./paths.ts";

describe("rateLimitFor", () => {
  it("DLsite の検索 HTML は robots.txt の Crawl-delay に合わせて 10 秒あける", () => {
    expect(rateLimitFor("https://www.dlsite.com/home/fsr/=/language/jp/page/1")).toEqual({
      key: "dlsite:html",
      intervalMs: 10_000,
    });
  });

  it("DLsite の product.json は別枠で 2 秒", () => {
    // 1 作品ごとに叩くため、検索と同じ 10 秒では 30 件で 5 分かかってしまう
    expect(
      rateLimitFor("https://www.dlsite.com/home/api/=/product.json?workno=RJ01698658"),
    ).toEqual({ key: "dlsite:api", intervalMs: 2_000 });
  });

  it("Audible は 302 を避けるため 6 秒", () => {
    expect(rateLimitFor("https://www.audible.co.jp/search?searchNarrator=x")).toEqual({
      key: "audible",
      intervalMs: 6_000,
    });
  });

  it("未知のホストにも間隔を入れる", () => {
    expect(rateLimitFor("https://example.com/a")).toEqual({
      key: "example.com",
      intervalMs: 5_000,
    });
  });
});

describe("safeFileName", () => {
  it("日本語は残し、パス区切りや空白を落とす", () => {
    expect(safeFileName("search-上田麗奈")).toBe("search-上田麗奈");
    expect(safeFileName("a/b\\c:d?e")).toBe("a_b_c_d_e");
    expect(safeFileName("  ")).toBe("unnamed");
  });

  it("長すぎる名前は切り詰める", () => {
    expect(safeFileName("あ".repeat(200))).toHaveLength(60);
  });
});
