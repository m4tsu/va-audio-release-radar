import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES_DIR } from "../lib/paths.ts";
import {
  buildProductUrl,
  buildSearchUrl,
  isNoSearchResultsLocation,
  parsePrice,
  parseRuntimeSeconds,
  parseSearchHtml,
  toIsoDate,
} from "./audible.ts";

/**
 * 実際に取得した HTML (crawler/fixtures/) に対する固定テスト。
 * flyout (popover) 側の重複した情報を拾っていないことも、ここで押さえる
 */

const FETCHED_AT = "2026-09-18T00:00:00.000Z";
const searchHtml = readFileSync(path.join(FIXTURES_DIR, "audible-search-ueda-reina.html"), "utf8");

describe("buildSearchUrl", () => {
  it("searchNarrator だけを付ける", () => {
    // pageSize / sort を足すと no-search-results へ 302 された (設計書 §3)
    expect(buildSearchUrl("上田麗奈")).toBe(
      "https://www.audible.co.jp/search?searchNarrator=%E4%B8%8A%E7%94%B0%E9%BA%97%E5%A5%88",
    );
  });
});

describe("buildProductUrl", () => {
  it("スラッグを含まない正規 URL を作る", () => {
    // 一覧の href は /pd/{slug}/{ASIN} だが、スラッグはタイトル変更で変わりうる (設計書 §3)
    expect(buildProductUrl("B0D6VXP222")).toBe("https://www.audible.co.jp/pd/B0D6VXP222");
  });
});

describe("isNoSearchResultsLocation", () => {
  it("該当なしページへの 302 だけを見分ける", () => {
    // 存在しない名前でも同じ 302 が返り、直後に別名を投げると 200 になる。
    // つまりこれは頻度制限ではなく「該当なし」なので、失敗ではなく empty として扱う
    expect(isNoSearchResultsLocation("/no-search-results?keywords=null")).toBe(true);
    expect(isNoSearchResultsLocation("https://www.audible.co.jp/no-search-results")).toBe(true);
    expect(isNoSearchResultsLocation("https://www.audible.co.jp/signin")).toBe(false);
    expect(isNoSearchResultsLocation(undefined)).toBe(false);
  });
});

describe("parseSearchHtml", () => {
  const parsed = parseSearchHtml(searchHtml, FETCHED_AT);

  it("商品リストの全件を取り、検証落ちが無い", () => {
    expect(parsed.works).toHaveLength(7);
    expect(parsed.invalidCount).toBe(0);
    expect(parsed.warnings).toEqual([]);
  });

  it("先頭の作品から各項目を取る", () => {
    expect(parsed.works[0]).toEqual({
      storeSlug: "audible",
      storeProductId: "B0D6VXP222",
      titleRaw: "千歳くんはラムネ瓶のなか　４（ガガガ文庫）",
      productUrl: "https://www.audible.co.jp/pd/B0D6VXP222",
      coverImageUrl: "https://m.media-amazon.com/images/I/51K67T2guZL._SL500_.jpg",
      releaseDate: "2024-06-28",
      durationSeconds: 9 * 3600 + 6 * 60,
      price: 2690,
      makerName: "小学館",
      creditedNames: [
        "馬場 惇平",
        "赤﨑 千夏",
        "阿澄 佳奈",
        "上田 麗奈",
        "天海 由梨奈",
        "奥野 香耶",
        "木村 隼人",
        "西山 宏太朗",
        "宮田 幸季",
        "酒巻 光宏",
      ],
      storeCategory: "audiobook",
      adult: false,
      fetchedAt: FETCHED_AT,
    });
  });

  it("flyout の短縮表記ではなく本文側のナレーター全員を取る", () => {
    // flyout 側は "馬場 惇平, 赤﨑 千夏, 阿澄 佳奈, 、その他" と省略され、検索対象の声優が載らない
    for (const work of parsed.works) {
      expect(work.creditedNames.length).toBeGreaterThan(3);
      expect(work.creditedNames.some((name) => name.includes("その他"))).toBe(false);
      expect(work.creditedNames.some((name) => name.replace(/\s/g, "") === "上田麗奈")).toBe(true);
    }
  });

  it("ナレーター名はストアの表記のまま入れる (姓名の空白は作品ごとに揺れる)", () => {
    // 同じ人でも作品によって "上田 麗奈" と "上田麗奈" の両方がある。
    // ここで寄せると元表記が失われるので、正規化は名寄せ (src/domain/identity.ts) の責務にする
    const spaced = parsed.works.find((work) => work.storeProductId === "B0D6VXP222");
    const unspaced = parsed.works.find((work) => work.storeProductId === "B086BPW2B9");
    expect(spaced?.creditedNames).toContain("上田 麗奈");
    expect(unspaced?.creditedNames).toContain("上田麗奈");
  });

  it("商品 URL はスラッグ無しの正規形になる", () => {
    for (const work of parsed.works) {
      expect(work.productUrl).toBe(`https://www.audible.co.jp/pd/${work.storeProductId}`);
    }
  });

  it("すべての作品が ASIN・配信日・再生時間を持つ", () => {
    for (const work of parsed.works) {
      expect(work.storeProductId).toMatch(/^B[0-9A-Z]{9}$/);
      expect(work.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(work.durationSeconds).toBeGreaterThan(0);
    }
  });
});

describe("toIsoDate", () => {
  it("YYYY/MM/DD を YYYY-MM-DD にする", () => {
    expect(toIsoDate("配信日：\n  2024/06/28\n")).toBe("2024-06-28");
    expect(toIsoDate("配信日： 2024/6/8")).toBe("2024-06-08");
    expect(toIsoDate("配信日：")).toBeUndefined();
  });
});

describe("parseRuntimeSeconds", () => {
  it("時間と分を秒にする", () => {
    expect(parseRuntimeSeconds("再生時間： 9 時間  6 分")).toBe(32760);
    expect(parseRuntimeSeconds("再生時間： 45 分")).toBe(2700);
    expect(parseRuntimeSeconds("再生時間： 2 時間")).toBe(7200);
    expect(parseRuntimeSeconds("再生時間：")).toBeUndefined();
  });
});

describe("parsePrice", () => {
  it("全角円記号付きの価格を数値にする", () => {
    expect(parsePrice("￥2,690 で購入、またはプレミアムプラン30日間無料体験で試す")).toBe(2690);
    expect(parsePrice("プレミアムプラン聴き放題対象")).toBeUndefined();
  });
});
