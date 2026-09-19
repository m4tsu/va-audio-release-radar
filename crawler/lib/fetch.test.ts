import { describe, expect, it } from "vitest";
import { parseRetryAfterMs, rateLimitFor } from "./fetch.ts";
import { safeFileName } from "./paths.ts";

describe("rateLimitFor", () => {
  it("DLsite の検索 HTML は robots.txt の Crawl-delay に合わせて 10 秒あける", () => {
    expect(rateLimitFor("https://www.dlsite.com/home/fsr/=/language/jp/page/1")).toEqual({
      key: "dlsite",
      intervalMs: 10_000,
    });
  });

  it("DLsite の product.json も同じ枠で 10 秒", () => {
    // Crawl-delay: 10 は User-agent: * グループにあり全パスに及ぶ。API だけ短くする根拠は無い
    expect(
      rateLimitFor("https://www.dlsite.com/home/api/=/product.json?workno=RJ01698658"),
    ).toEqual({ key: "dlsite", intervalMs: 10_000 });
  });

  it("Audible は 302 を避けるため 6 秒", () => {
    expect(rateLimitFor("https://www.audible.co.jp/search?searchNarrator=x")).toEqual({
      key: "audible",
      intervalMs: 6_000,
    });
  });

  it("AniList は劣化状態の上限 30 req/min に対し余裕を取って 3.0 秒", () => {
    // 2026-09-19 時点、docs.anilist.co/guide/rate-limiting と実測ヘッダの両方が
    // 30 req/min を示している (docs/stores/anilist.md の「レート間隔」)。公称の 90 req/min は
    // 平常時の値であって現在の実効値ではない
    expect(rateLimitFor("https://graphql.anilist.co")).toEqual({
      key: "anilist",
      intervalMs: 3_000,
    });
  });

  it("DLsite の sitemap も同じ枠で 10 秒", () => {
    // ホストが dlsite.com なら一律 10 秒。1 本 22MB あるため連打しない
    expect(
      rateLimitFor("https://www.dlsite.com/modpub/sitemap-xml/indexes/home_index.xml"),
    ).toEqual({ key: "dlsite", intervalMs: 10_000 });
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

describe("parseRetryAfterMs", () => {
  const now = Date.parse("2026-09-18T00:00:00Z");

  it("秒数で来たらミリ秒にする", () => {
    expect(parseRetryAfterMs("15", now)).toBe(15_000);
  });

  it("HTTP-date で来たら現在時刻との差にする", () => {
    expect(parseRetryAfterMs("Fri, 18 Sep 2026 00:00:30 GMT", now)).toBe(30_000);
  });

  it("過去の日時なら 0 にする (負の待ち時間にしない)", () => {
    expect(parseRetryAfterMs("Fri, 18 Sep 2026 00:00:00 GMT", now + 5_000)).toBe(0);
  });

  it("ヘッダが無い・読めないときは undefined", () => {
    expect(parseRetryAfterMs(null, now)).toBeUndefined();
    expect(parseRetryAfterMs("   ", now)).toBeUndefined();
    expect(parseRetryAfterMs("soon", now)).toBeUndefined();
  });
});
