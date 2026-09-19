import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FetchResult } from "../lib/fetch.ts";
import { fetchText } from "../lib/fetch.ts";
import { FIXTURES_DIR } from "../lib/paths.ts";
import {
  audibleAdapter,
  buildProductUrl,
  buildSearchUrl,
  isNoSearchResultsLocation,
  parsePrice,
  parseRuntimeSeconds,
  parseSearchHtml,
  parseTotalCount,
  toIsoDate,
} from "./audible.ts";

// fetchText (ネットワーク / レート制限を持つ) を差し替え、search-{名前} ごとに応答を固定する。
// T8: searchNames のフォールバック順序を、実際の Audible にアクセスせず検証する
vi.mock("../lib/fetch.ts", () => ({ fetchText: vi.fn() }));

/**
 * 実際に取得した HTML (crawler/fixtures/) に対する固定テスト。
 * flyout (popover) 側の重複した情報を拾っていないことも、ここで押さえる
 */

const FETCHED_AT = "2026-09-18T00:00:00.000Z";
const searchHtml = readFileSync(path.join(FIXTURES_DIR, "audible-search-ueda-reina.html"), "utf8");

describe("buildSearchUrl", () => {
  it("sort=pubdate-desc-rank を付けて発売日降順にする", () => {
    // 既定 (sort 無し) は人気順で、20 件を超える声優は新作が 1 ページ目に載らない。
    // pageSize / page を足すと no-search-results へ 302 されるが、sort 単独なら 200 (実測、設計書 §3)
    expect(buildSearchUrl("上田麗奈")).toBe(
      "https://www.audible.co.jp/search?searchNarrator=%E4%B8%8A%E7%94%B0%E9%BA%97%E5%A5%88&sort=pubdate-desc-rank",
    );
  });
});

describe("buildSearchUrl", () => {
  it("既定は新しい順 (pubdate-desc-rank)", () => {
    expect(buildSearchUrl("上田 麗奈")).toBe(
      "https://www.audible.co.jp/search?searchNarrator=%E4%B8%8A%E7%94%B0%20%E9%BA%97%E5%A5%88&sort=pubdate-desc-rank",
    );
  });

  it("古い順は sort だけが変わる", () => {
    expect(buildSearchUrl("上田 麗奈", "pubdate-asc-rank")).toBe(
      "https://www.audible.co.jp/search?searchNarrator=%E4%B8%8A%E7%94%B0%20%E9%BA%97%E5%A5%88&sort=pubdate-asc-rank",
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
      // Audible は年齢区分を公開していない (設計書 §14)
      ageRating: "unknown",
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

describe("parseTotalCount", () => {
  // 実測 HTML 断片 (石田彰の検索結果、38 件中 20 件表示)。フィクスチャ
  // (audible-search-ueda-reina.html) は sort 無しで取得したもので、この表示自体が無い
  const summaryHtml =
    '<span class="bc-text\n    resultsSummarySubheading \n    \n    \n    bc-color-secondary"  >検索結果 38  のうち 1 - 20 件</span>';

  it("「検索結果 N のうち」から総件数を取る", () => {
    expect(parseTotalCount(summaryHtml)).toBe(38);
  });

  it("表示が無ければ undefined", () => {
    expect(parseTotalCount(searchHtml)).toBeUndefined();
    expect(parseTotalCount("<html></html>")).toBeUndefined();
  });
});

describe("parseSearchHtml の totalCount", () => {
  const summaryHtml = '<span class="resultsSummarySubheading">検索結果 38  のうち 1 - 20 件</span>';

  it("総件数を totalCount に載せる。取りこぼしの判断はここではしない", () => {
    // 並び順違いの 1 ページ目を足した後でないと網羅率は決まらないので、警告は fetchByActor 側 (T12)
    const html = `${summaryHtml}${htmlWithOneWorkFixture("B000000009")}`;
    const parsed = parseSearchHtml(html, FETCHED_AT);
    expect(parsed.totalCount).toBe(38);
    expect(parsed.warnings).toEqual([]);
  });

  it("総件数の表示が無ければ totalCount は undefined", () => {
    const parsed = parseSearchHtml(searchHtml, FETCHED_AT);
    expect(parsed.totalCount).toBeUndefined();
    expect(parsed.warnings).toEqual([]);
  });
});

/** 1 件の productListItem だけを持つ最小限の HTML (検証を通す最小項目だけ埋める) */
function htmlWithOneWorkFixture(asin: string): string {
  return `<li class="productListItem" id="product-list-item-${asin}"><h3><a href="/pd/x/${asin}">Title ${asin}</a></h3></li>`;
}

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

describe("fetchByActor", () => {
  const fetchTextMock = vi.mocked(fetchText);

  afterEach(() => {
    fetchTextMock.mockReset();
  });

  /** 1 件の productListItem だけを持つ最小限の HTML。検証 (rawWorkSchema) を通る最小項目だけ埋める */
  function htmlWithOneWork(asin: string): string {
    return `<li class="productListItem" id="product-list-item-${asin}"><h3><a href="/pd/x/${asin}">Title ${asin}</a></h3></li>`;
  }

  function ok(body: string): FetchResult {
    return { ok: true, status: 200, url: "https://www.audible.co.jp/search", body };
  }

  function emptyRedirect(): FetchResult {
    // 存在しない名前でも 302 で no-search-results に飛ばされる。isNoSearchResultsLocation が拾う形
    return {
      ok: false,
      url: "https://www.audible.co.jp/search",
      status: 302,
      location: "/no-search-results?keywords=null",
      reason: "リダイレクト (302) → /no-search-results?keywords=null",
    };
  }

  function networkError(): FetchResult {
    return {
      ok: false,
      url: "https://www.audible.co.jp/search",
      reason: "AbortError: The operation was aborted",
    };
  }

  it("1 つ目が該当なしでも、2 つ目で 1 件見つかれば確定する", async () => {
    // 実測どおり: 空白なし (石見舞菜香) が該当なし、空白あり (石見 舞菜香) で見つかる
    fetchTextMock.mockResolvedValueOnce(emptyRedirect());
    fetchTextMock.mockResolvedValueOnce(ok(htmlWithOneWork("B000000001")));

    const result = await audibleAdapter.fetchByActor(
      { canonicalName: "石見舞菜香", searchNames: ["石見舞菜香", "石見 舞菜香"] },
      { snapshot: false },
    );

    expect(fetchTextMock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("ok");
    expect(result.works).toHaveLength(1);
    expect(result.queryUsed).toBe("石見 舞菜香");
  });

  it("全候補が該当なしなら empty で確定する", async () => {
    fetchTextMock.mockResolvedValueOnce(emptyRedirect());
    fetchTextMock.mockResolvedValueOnce(emptyRedirect());

    const result = await audibleAdapter.fetchByActor(
      { canonicalName: "水瀬いのり", searchNames: ["水瀬 いのり", "水瀬いのり"] },
      { snapshot: false },
    );

    expect(fetchTextMock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("empty");
    expect(result.works).toHaveLength(0);
    expect(result.queryUsed).toBe("水瀬 いのり");
  });

  it("error と empty が混ざっても他の候補を試し、empty があれば empty で確定する", async () => {
    fetchTextMock.mockResolvedValueOnce(networkError());
    fetchTextMock.mockResolvedValueOnce(emptyRedirect());

    const result = await audibleAdapter.fetchByActor(
      { canonicalName: "テスト太郎", searchNames: ["テスト 太郎", "テスト太郎"] },
      { snapshot: false },
    );

    expect(fetchTextMock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("empty");
    expect(result.queryUsed).toBe("テスト太郎");
  });

  it("全候補が失敗 (error) したときだけ error で確定する", async () => {
    fetchTextMock.mockResolvedValueOnce(networkError());
    fetchTextMock.mockResolvedValueOnce(networkError());

    const result = await audibleAdapter.fetchByActor(
      { canonicalName: "テスト太郎", searchNames: ["テスト 太郎", "テスト太郎"] },
      { snapshot: false },
    );

    expect(fetchTextMock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("error");
    expect(result.queryUsed).toBe("テスト太郎");
  });

  it("searchNames が空なら canonicalName だけで検索する", async () => {
    fetchTextMock.mockResolvedValueOnce(ok(htmlWithOneWork("B000000002")));

    const result = await audibleAdapter.fetchByActor(
      { canonicalName: "上田麗奈", searchNames: [] },
      { snapshot: false },
    );

    expect(fetchTextMock).toHaveBeenCalledTimes(1);
    expect(result.queryUsed).toBe("上田麗奈");
    expect(result.status).toBe("ok");
  });

  // --- 網羅率と古い順での補完 (T12) ---------------------------------------

  /** 「検索結果 N のうち」の表示。総件数はここからしか取れない */
  function summary(total: number): string {
    return `<span class="resultsSummarySubheading">検索結果 ${total}  のうち 1 - 20 件</span>`;
  }

  const ACTOR = { canonicalName: "上田麗奈", searchNames: ["上田麗奈"] };

  it("総件数が 20 件以下なら古い順の追加リクエストを出さない", async () => {
    fetchTextMock.mockResolvedValueOnce(ok(`${summary(7)}${htmlWithOneWork("B000000010")}`));

    const result = await audibleAdapter.fetchByActor(ACTOR, { snapshot: false });

    expect(fetchTextMock).toHaveBeenCalledTimes(1);
    expect(result.coverage).toEqual({ fetched: 1, total: 7, complete: false, pages: 1 });
  });

  it("総件数が 20 件を超えると古い順を 1 回足して和集合を取る", async () => {
    fetchTextMock
      .mockResolvedValueOnce(
        ok(`${summary(21)}${htmlWithOneWork("B000000011")}${htmlWithOneWork("B000000012")}`),
      )
      .mockResolvedValueOnce(
        // 重複 (B000000012) を含む古い順。ASIN で束ねるので 3 件になる
        ok(`${summary(21)}${htmlWithOneWork("B000000012")}${htmlWithOneWork("B000000013")}`),
      );

    const result = await audibleAdapter.fetchByActor(ACTOR, { snapshot: false });

    expect(fetchTextMock).toHaveBeenCalledTimes(2);
    expect(fetchTextMock.mock.calls[1]?.[0]).toBe(buildSearchUrl("上田麗奈", "pubdate-asc-rank"));
    expect(result.works.map((work) => work.storeProductId)).toEqual([
      "B000000011",
      "B000000012",
      "B000000013",
    ]);
    expect(result.coverage).toEqual({ fetched: 3, total: 21, complete: false, pages: 2 });
    expect(result.warnings).toContain("網羅率 3/21");
  });

  it("古い順の取得に失敗しても新しい順の結果で続行する", async () => {
    fetchTextMock
      .mockResolvedValueOnce(ok(`${summary(21)}${htmlWithOneWork("B000000014")}`))
      .mockResolvedValueOnce(networkError());

    const result = await audibleAdapter.fetchByActor(ACTOR, { snapshot: false });

    expect(result.status).toBe("ok");
    expect(result.works).toHaveLength(1);
    expect(result.coverage).toEqual({ fetched: 1, total: 21, complete: false, pages: 1 });
    expect(result.warnings.some((warning) => warning.startsWith("古い順での補完に失敗"))).toBe(
      true,
    );
  });

  it("総件数の表示が無ければ complete を立てず、追加リクエストも出さない", async () => {
    fetchTextMock.mockResolvedValueOnce(ok(htmlWithOneWork("B000000015")));

    const result = await audibleAdapter.fetchByActor(ACTOR, { snapshot: false });

    expect(fetchTextMock).toHaveBeenCalledTimes(1);
    expect(result.coverage).toEqual({ fetched: 1, pages: 1 });
    expect(result.warnings).toEqual([]);
  });

  it("該当なし (empty) でも網羅率は 0/0 として残す", async () => {
    fetchTextMock.mockResolvedValueOnce(emptyRedirect());

    const result = await audibleAdapter.fetchByActor(ACTOR, { snapshot: false });

    expect(result.status).toBe("empty");
    expect(result.coverage).toEqual({ fetched: 0, total: 0, complete: true, pages: 1 });
  });
});
