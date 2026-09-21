import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FetchResult } from "../lib/fetch.ts";
import { fetchText } from "../lib/fetch.ts";
import { FIXTURES_DIR } from "../lib/paths.ts";
import {
  AUDIBLE_FEED_URLS,
  audibleAdapter,
  buildProductUrl,
  buildSearchUrl,
  isNoSearchResultsLocation,
  parseRuntimeSeconds,
  parseSearchHtml,
  parseTotalCount,
  toIsoDate,
} from "./audible.ts";

// fetchText (ネットワーク / レート制限を持つ) を差し替え、search-{名前} ごとに応答を固定する。
// searchNames のフォールバック順序を、実際の Audible にアクセスせず検証する
vi.mock("../lib/fetch.ts", () => ({ fetchText: vi.fn() }));

/**
 * 実際に取得した HTML (crawler/fixtures/) に対する固定テスト。
 * flyout (popover) 側の重複した情報を拾っていないことも、ここで押さえる
 */

const FETCHED_AT = "2026-09-18T00:00:00.000Z";
const searchHtml = readFileSync(path.join(FIXTURES_DIR, "audible-search-ueda-reina.html"), "utf8");
// ヒット 1 件の実 HTML。総件数サマリの表記が複数件のときと違う
const singleHitHtml = readFileSync(
  path.join(FIXTURES_DIR, "audible-search-genda-tesshou.html"),
  "utf8",
);
// searchNarrator= が姓だけでも一致する実 HTML。総件数 355 に対し本人名義は 0 件
const looseMatchHtml = readFileSync(
  path.join(FIXTURES_DIR, "audible-search-sato-hajime.html"),
  "utf8",
);
/** 新着一覧の実 HTML (2026-09-21 取得)。素の /newreleases と、配信日の新しい順 */
const newReleasesHtml = readFileSync(path.join(FIXTURES_DIR, "audible-newreleases.html"), "utf8");
/** 同じ日の配信日の新しい順。フィクスチャの 6 件すべてナレーター欄が空 */
const newReleasesPubdateDescHtml = readFileSync(
  path.join(FIXTURES_DIR, "audible-newreleases-pubdate-desc.html"),
  "utf8",
);
// ページングの実 HTML。斉藤壮馬 (総件数 164) の 1 ページ目と最終ページ。
// 1 ページ目は 20 件で埋まり、9 ページ目は 4 件しかない
const pagedFirstHtml = readFileSync(
  path.join(FIXTURES_DIR, "audible-search-saito-souma-page1.html"),
  "utf8",
);
const pagedLastHtml = readFileSync(
  path.join(FIXTURES_DIR, "audible-search-saito-souma-page9.html"),
  "utf8",
);

describe("buildSearchUrl", () => {
  it("1 ページ目は searchNarrator だけの素の URL にする", () => {
    // sort= は robots.txt (#Block searchAuthor/Narrator/Provider &sort=) が値を問わず禁じている。
    // page= は searchNarrator と 2 つだけの形を禁じる規則が無いので使える
    expect(buildSearchUrl("上田麗奈")).toBe(
      "https://www.audible.co.jp/search?searchNarrator=%E4%B8%8A%E7%94%B0%E9%BA%97%E5%A5%88",
    );
    expect(buildSearchUrl("上田 麗奈")).toBe(
      "https://www.audible.co.jp/search?searchNarrator=%E4%B8%8A%E7%94%B0%20%E9%BA%97%E5%A5%88",
    );
  });

  it("2 ページ目以降だけ &page=N を足す", () => {
    expect(buildSearchUrl("上田 麗奈", 2)).toBe(
      "https://www.audible.co.jp/search?searchNarrator=%E4%B8%8A%E7%94%B0%20%E9%BA%97%E5%A5%88&page=2",
    );
    expect(buildSearchUrl("上田 麗奈", 9)).toBe(
      "https://www.audible.co.jp/search?searchNarrator=%E4%B8%8A%E7%94%B0%20%E9%BA%97%E5%A5%88&page=9",
    );
  });

  it("page=1 は素の URL と同じ形にする", () => {
    // 実測で page=1 と page 無しは ASIN まで完全に一致した。パラメータが少ないほうを正規形にする
    expect(buildSearchUrl("上田 麗奈", 1)).toBe(buildSearchUrl("上田 麗奈"));
  });

  it("robots.txt の Disallow に一致しない形になっている", () => {
    // sort= を含まないこと、node= を含まないこと、searchNarrator 以外の `=` が page= だけであること。
    // Disallow: /search*searchNarrator=*=*=*= は searchNarrator= の後ろに `=` が 3 つ要るので、
    // page= を 1 つ足しただけでは一致しない
    const url = buildSearchUrl("斉藤 壮馬", 9);
    expect(url).not.toContain("sort=");
    expect(url).not.toContain("node=");
    expect(url.split("searchNarrator=")[1]?.split("=").length).toBe(2);
  });
});

describe("buildProductUrl", () => {
  it("スラッグを含まない正規 URL を作る", () => {
    // 一覧の href は /pd/{slug}/{ASIN} だが、スラッグはタイトル変更で変わりうる
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
      // Audible は年齢区分を公開していない
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
  // (audible-search-ueda-reina.html) は商品リストだけを残したもので、この表示自体が無い
  const summaryHtml =
    '<span class="bc-text\n    resultsSummarySubheading \n    \n    \n    bc-color-secondary"  >検索結果 38  のうち 1 - 20 件</span>';

  it("「検索結果 N のうち」から総件数を取る", () => {
    expect(parseTotalCount(summaryHtml)).toBe(38);
  });

  it("ヒットが 1 件のときの別表記からも総件数を取る", () => {
    // 500 人のクロールで総件数を読めなかった 73 件は全部これ。1 件のときだけ
    // 「のうち」が出ず、実 HTML では「検索結果 1 件」とだけ書かれる
    expect(parseTotalCount(singleHitHtml)).toBe(1);
  });

  it("桁区切りのカンマが入っても数値にする", () => {
    // 実測では 4 桁以上のナレーターに当たっていないが、出たときに黙って undefined にしない
    expect(parseTotalCount("検索結果 1,234  のうち 1 - 20 件")).toBe(1234);
  });

  it("表示が無ければ undefined", () => {
    // ueda のフィクスチャは商品リストだけを残したもので、サマリの span が無い
    expect(parseTotalCount(searchHtml)).toBeUndefined();
    expect(parseTotalCount("<html></html>")).toBeUndefined();
  });
});

describe("parseSearchHtml の totalCount", () => {
  const summaryHtml = '<span class="resultsSummarySubheading">検索結果 38  のうち 1 - 20 件</span>';

  it("総件数を totalCount に載せる。取りこぼしの判断はここではしない", () => {
    // 2 ページ目以降を足した後でないと網羅率は決まらないので、警告は fetchByActor 側
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

describe("parseSearchHtml (ページングした実 HTML)", () => {
  const first = parseSearchHtml(pagedFirstHtml, FETCHED_AT);
  const last = parseSearchHtml(pagedLastHtml, FETCHED_AT);

  it("1 ページ目は 20 件で埋まり、総件数 164 を読める", () => {
    expect(first.works).toHaveLength(20);
    expect(first.invalidCount).toBe(0);
    expect(first.totalCount).toBe(164);
  });

  it("最終ページ (9 ページ目) は 4 件で、総件数は同じ 164", () => {
    // 164 = 20 × 8 + 4。「埋まっていないページが来たら打ち切ってよい」の根拠になる実データ
    expect(last.works).toHaveLength(4);
    expect(last.invalidCount).toBe(0);
    expect(last.totalCount).toBe(164);
  });

  it("1 ページ目と最終ページで ASIN が重複しない", () => {
    // 並び順のはしごと違い、ページングでは同じ作品が 2 度出てこない (9 ページ 164 件で重複 0 を実測)
    const firstIds = new Set(first.works.map((work) => work.storeProductId));
    expect(last.works.some((work) => firstIds.has(work.storeProductId))).toBe(false);
  });

  it("sort= を外して人気順のままでも本人名義の作品が並ぶ", () => {
    // 20 件中 19 件が本人名義。残り 1 件は本人の冠番組でナレーター欄が空
    const credited = first.works.filter((work) =>
      work.creditedNames.some((name) => name.replace(/\s/g, "") === "斉藤壮馬"),
    );
    expect(credited).toHaveLength(19);
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

describe("fetchByActor", () => {
  const fetchTextMock = vi.mocked(fetchText);

  afterEach(() => {
    fetchTextMock.mockReset();
  });

  /** 1 件の productListItem だけを持つ最小限の HTML。検証 (rawWorkSchema) を通る最小項目だけ埋める */
  function htmlWithOneWork(asin: string, narrator = "上田 麗奈"): string {
    // ナレーター欄を入れるのは、本人名義かどうかの一致率を測るため。
    // 既定を検索対象の声優にしてあるので、名前を渡さない限り「正しく引けている」状態になる
    return (
      `<li class="productListItem" id="product-list-item-${asin}">` +
      `<h3><a href="/pd/x/${asin}">Title ${asin}</a></h3>` +
      // 実 HTML と同じく ul で包む。li を直接入れ子にするとパーサーが外側の li を閉じてしまう
      `<ul><li class="narratorLabel"><a>${narrator}</a></li></ul></li>`
    );
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
    fetchTextMock.mockResolvedValueOnce(ok(htmlWithOneWork("B000000001", "石見 舞菜香")));

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

  // --- 網羅率とページング -------------------------------

  /** 複数件ヒット時の総件数サマリ。1 件のときだけ表記が変わる (parseTotalCount のテスト参照) */
  function summary(total: number): string {
    return `<span class="resultsSummarySubheading">検索結果 ${total}  のうち 1 - 20 件</span>`;
  }

  /** 連番の ASIN で商品リストを作る。`from` 番から `count` 件 (既定は 1 ページ分の 20 件) */
  function page(from: number, count = 20, narrator?: string): string {
    return Array.from({ length: count }, (_value, index) =>
      htmlWithOneWork(`B${String(from + index).padStart(9, "0")}`, narrator),
    ).join("");
  }

  const ACTOR = { canonicalName: "上田麗奈", searchNames: ["上田麗奈"] };

  it("総件数が 1 ページに収まるなら 2 ページ目を引かない", async () => {
    fetchTextMock.mockResolvedValueOnce(ok(`${summary(7)}${page(1, 7)}`));

    const result = await audibleAdapter.fetchByActor(ACTOR, { snapshot: false });

    expect(fetchTextMock).toHaveBeenCalledTimes(1);
    expect(fetchTextMock.mock.calls[0]?.[0]).toBe(buildSearchUrl("上田麗奈"));
    expect(result.coverage).toEqual({ fetched: 7, total: 7, complete: true, pages: 1, matched: 7 });
  });

  it("総件数が 1 ページに収まるなら、取得件数が足りなくても引き直さない", async () => {
    // 2 ページ目が存在しないので、解析落ちで件数が合わなくても引く先が無い。
    // 相手に負荷をかけるだけで 1 件も増えない
    fetchTextMock.mockResolvedValueOnce(ok(`${summary(7)}${htmlWithOneWork("B000000010")}`));

    const result = await audibleAdapter.fetchByActor(ACTOR, { snapshot: false });

    expect(fetchTextMock).toHaveBeenCalledTimes(1);
    expect(result.coverage).toEqual({
      fetched: 1,
      total: 7,
      complete: false,
      pages: 1,
      matched: 1,
    });
  });

  it("和集合が総件数に届いた時点で打ち切る", async () => {
    // 総件数 21。1 ページ目で 20 件、2 ページ目の 1 件で 21 件に届くので 3 ページ目は引かない
    fetchTextMock
      .mockResolvedValueOnce(ok(`${summary(21)}${page(1)}`))
      .mockResolvedValueOnce(ok(`${summary(21)}${page(21, 1)}`));

    const result = await audibleAdapter.fetchByActor(ACTOR, { snapshot: false });

    expect(fetchTextMock).toHaveBeenCalledTimes(2);
    expect(fetchTextMock.mock.calls[1]?.[0]).toBe(buildSearchUrl("上田麗奈", 2));
    expect(result.coverage).toEqual({
      fetched: 21,
      total: 21,
      complete: true,
      pages: 2,
      matched: 21,
    });
    expect(result.warnings).toEqual([]);
  });

  it("ページ番号は 1 始まりで、2 ページ目から順に引く", async () => {
    // 実測 (斉藤壮馬): page 無しと page=1 は同じ 20 件、page=2 は 21 件目から。
    // 0 始まりだと page=2 が 41 件目からになるが、そうはならなかった
    fetchTextMock
      .mockResolvedValueOnce(ok(`${summary(45)}${page(1)}`))
      .mockResolvedValueOnce(ok(`${summary(45)}${page(21)}`))
      .mockResolvedValueOnce(ok(`${summary(45)}${page(41, 5)}`));

    const result = await audibleAdapter.fetchByActor(ACTOR, { snapshot: false });

    expect(fetchTextMock.mock.calls.map((call) => call[0])).toEqual([
      buildSearchUrl("上田麗奈"),
      buildSearchUrl("上田麗奈", 2),
      buildSearchUrl("上田麗奈", 3),
    ]);
    expect(result.coverage).toEqual({
      fetched: 45,
      total: 45,
      complete: true,
      pages: 3,
      matched: 45,
    });
  });

  it("ページ間で ASIN が重複したら畳んだうえで警告に残す", async () => {
    // ページングでは本来重複しない (実測で 164 件中 0 件)。出たら取得中に並びが動いた合図で、
    // ずれた分だけ取りこぼしている可能性がある。黙って畳むと気づけない
    fetchTextMock
      .mockResolvedValueOnce(ok(`${summary(45)}${page(1)}`))
      // 1 件ぶんずれて B000000020 が 2 ページ目にも出る
      .mockResolvedValueOnce(ok(`${summary(45)}${page(20)}`))
      .mockResolvedValueOnce(ok(`${summary(45)}${page(40, 6)}`));

    const result = await audibleAdapter.fetchByActor(ACTOR, { snapshot: false });

    expect(new Set(result.works.map((work) => work.storeProductId)).size).toBe(result.works.length);
    expect(result.works).toHaveLength(45);
    expect(result.warnings).toContain("2 ページ目に既出の作品が 1 件 (取得中に並びが動いた可能性)");
  });

  it("届かないときは 10 ページで打ち切り、上限に当たったことを残す", async () => {
    // 総件数 400。1 声優あたり 20 件 × 10 ページ = 200 件を上限にしている
    for (let index = 0; index < 12; index += 1) {
      fetchTextMock.mockResolvedValueOnce(ok(`${summary(400)}${page(1 + index * 20)}`));
    }

    const result = await audibleAdapter.fetchByActor(ACTOR, { snapshot: false });

    expect(fetchTextMock).toHaveBeenCalledTimes(10);
    expect(fetchTextMock.mock.calls.map((call) => call[0])).toEqual([
      buildSearchUrl("上田麗奈"),
      ...Array.from({ length: 9 }, (_value, index) => buildSearchUrl("上田麗奈", index + 2)),
    ]);
    expect(result.coverage).toEqual({
      fetched: 200,
      total: 400,
      complete: false,
      pages: 10,
      matched: 200,
    });
    expect(result.warnings).toContain("網羅率 200/400");
    expect(result.warnings).toContain("400 件中 200 件まで取得 (1 声優あたり 10 ページが上限)");
  });

  it("途中のページが失敗したら、そこまでの結果で打ち切る", async () => {
    // 相手が答えられない状態で残りを投げ続けない (fetchText 側で既に 4 回再試行している)
    fetchTextMock
      .mockResolvedValueOnce(ok(`${summary(164)}${page(1)}`))
      .mockResolvedValueOnce(networkError());

    const result = await audibleAdapter.fetchByActor(ACTOR, { snapshot: false });

    expect(fetchTextMock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("ok");
    expect(result.works).toHaveLength(20);
    expect(result.coverage).toEqual({
      fetched: 20,
      total: 164,
      complete: false,
      pages: 1,
      matched: 20,
    });
    expect(result.warnings.some((warning) => warning.startsWith("2 ページ目の取得に失敗"))).toBe(
      true,
    );
    // 上限ページまで行っていないので、上限の警告は鳴らさない
    expect(result.warnings.some((warning) => warning.includes("上限"))).toBe(false);
  });

  it("1 ページ目で総件数を読めなくても、後のページで読めれば拾う", async () => {
    // 1 ページ目が埋まっていれば続きがあると分かるので、総件数不明でも次のページへ進む
    fetchTextMock
      .mockResolvedValueOnce(ok(page(1)))
      .mockResolvedValueOnce(ok(`${summary(30)}${page(21, 10)}`));

    const result = await audibleAdapter.fetchByActor(ACTOR, { snapshot: false });

    expect(fetchTextMock).toHaveBeenCalledTimes(2);
    expect(result.coverage).toEqual({
      fetched: 30,
      total: 30,
      complete: true,
      pages: 2,
      matched: 30,
    });
    expect(result.totalCount).toBe(30);
  });

  // --- 総件数を読めなかったときの扱い -----------------------------

  it("総件数が読めず 1 ページ目が埋まっていなければ、全件取れたとみなす", async () => {
    // 20 件未満 = ページングが起きていない = これがその声優の全作品。
    // 「不明」のまま残すと、網羅率が分からない run が積み上がる (実測 73 件)
    fetchTextMock.mockResolvedValueOnce(ok(htmlWithOneWork("B000000015")));

    const result = await audibleAdapter.fetchByActor(ACTOR, { snapshot: false });

    expect(fetchTextMock).toHaveBeenCalledTimes(1);
    expect(result.coverage).toEqual({ fetched: 1, total: 1, complete: true, pages: 1, matched: 1 });
    expect(result.warnings).toEqual([]);
  });

  it("実 HTML (ヒット 1 件) でも総件数を読んで網羅完了にする", async () => {
    fetchTextMock.mockResolvedValueOnce(ok(singleHitHtml));

    const result = await audibleAdapter.fetchByActor(
      { canonicalName: "玄田哲章", searchNames: ["玄田 哲章"] },
      { snapshot: false },
    );

    expect(fetchTextMock).toHaveBeenCalledTimes(1);
    expect(result.works).toHaveLength(1);
    expect(result.coverage).toEqual({ fetched: 1, total: 1, complete: true, pages: 1, matched: 1 });
  });

  it("総件数が読めないまま上限ページまで埋まっていたら「不明」のままにする", async () => {
    // どのページも 20 件ちょうどで総件数も読めない。続きがあるかどうか分からないので
    // complete を立てない。分母が無いので「200 件まで取得」の警告も鳴らさない
    for (let index = 0; index < 12; index += 1) {
      fetchTextMock.mockResolvedValueOnce(ok(page(1 + index * 20)));
    }

    const result = await audibleAdapter.fetchByActor(ACTOR, { snapshot: false });

    expect(fetchTextMock).toHaveBeenCalledTimes(10);
    expect(result.coverage).toEqual({ fetched: 200, pages: 10, matched: 200 });
    expect(result.totalCount).toBeUndefined();
    expect(result.warnings.some((warning) => warning.includes("上限"))).toBe(false);
  });

  it("検証落ちを引いた分は「そのページが埋まっていない」の判定に入れない", async () => {
    // 1 ページ 20 件のうち 1 件が検証に落ちる (ここでは表紙がプレースホルダ画像で https URL でない)
    // と works は 19 件になるが、続きのページはある。works の数で判断すると
    // 「20 件未満だから最終ページだ」と誤るので、捨てた分を数に戻してから判定する
    const brokenItem =
      '<li class="productListItem" id="product-list-item-B099999999">' +
      '<h3><a href="/pd/x/B099999999">壊れた行</a></h3>' +
      '<ul><li class="narratorLabel"><a>上田 麗奈</a></li></ul>' +
      '<img class="bc-image-inset-border" src="data:image/gif;base64,R0lGOD"></li>';
    fetchTextMock
      .mockResolvedValueOnce(ok(`${page(1, 19)}${brokenItem}`))
      .mockResolvedValueOnce(ok(`${summary(25)}${page(20, 6)}`));

    const result = await audibleAdapter.fetchByActor(ACTOR, { snapshot: false });

    expect(fetchTextMock).toHaveBeenCalledTimes(2);
    expect(result.invalidCount).toBe(1);
    expect(result.coverage).toEqual({
      fetched: 25,
      total: 25,
      complete: true,
      pages: 2,
      matched: 25,
    });
  });

  // --- 検索語が広すぎるときの扱い --------------------------------

  it("本人が 1 件もクレジットされていなければ、総件数を分母にしない", async () => {
    // 実測: 「佐藤 元」で引くと総件数 355 件が返るが、1 ページ目のナレーターは
    // 佐藤恵・佐藤詩乃・佐藤弘樹などで佐藤元は 1 件も含まれない。
    // この 355 は佐藤姓のナレーター作品の総数であって、佐藤元の作品数ではない
    for (let index = 0; index < 12; index += 1) {
      fetchTextMock.mockResolvedValueOnce(
        ok(`${summary(355)}${page(1 + index * 20, 20, "佐藤 恵")}`),
      );
    }

    const result = await audibleAdapter.fetchByActor(
      { canonicalName: "佐藤元", searchNames: ["佐藤 元"] },
      { snapshot: false },
    );

    // total も complete も落として「不明」にする。complete: false にすると
    // 「佐藤元の作品を取り逃した」という別の主張になってしまう
    expect(result.coverage).toEqual({ fetched: 200, pages: 10, matched: 0 });
    expect(result.totalCount).toBeUndefined();
    expect(result.warnings).toContain(
      "検索語が広すぎる可能性 (本人名義 0/200 件)。総件数 355 は同姓の別人を含むとみて網羅率は不明とする",
    );
    // 網羅率の警告は鳴らさない。分母が信用できないものを取りこぼしとして出し続けても意味がない
    expect(result.warnings.some((warning) => warning.startsWith("網羅率"))).toBe(false);
  });

  it("本人名義が大半なら、1 件混ざっても網羅率をそのまま出す", async () => {
    // 斉藤壮馬は全 164 件中 163 件が本人名義。残り 1 件は本人の冠番組でナレーター欄が空。
    // この程度の混入で分母を捨てると、正しく引けている声優の網羅率まで見えなくなる
    // 1 ページ目だけ 19 件 + 別人 1 件。2〜8 ページ目が 20 件ずつ、9 ページ目が 4 件で計 164 件
    const other = htmlWithOneWork("B000009999", "別人 太郎");
    fetchTextMock.mockResolvedValueOnce(ok(`${summary(164)}${page(1, 19, "斉藤 壮馬")}${other}`));
    for (let index = 1; index <= 7; index += 1) {
      fetchTextMock.mockResolvedValueOnce(
        ok(`${summary(164)}${page(1 + index * 20, 20, "斉藤 壮馬")}`),
      );
    }
    fetchTextMock.mockResolvedValueOnce(ok(`${summary(164)}${page(161, 4, "斉藤 壮馬")}`));

    const result = await audibleAdapter.fetchByActor(
      { canonicalName: "斉藤壮馬", searchNames: ["斉藤 壮馬"] },
      { snapshot: false },
    );

    expect(result.coverage).toEqual({
      fetched: 164,
      total: 164,
      complete: true,
      pages: 9,
      matched: 163,
    });
    expect(result.warnings.some((warning) => warning.startsWith("検索語が広すぎる"))).toBe(false);
  });

  it("異体字違いの表記でも本人名義として数える", async () => {
    // 検索は「斉藤 壮馬」で通っても、作品側の表記が「齊藤壮馬」ということがある。
    // normalizeName が常用漢字表の異体字 (齊→斉) を畳むので一致する
    fetchTextMock.mockResolvedValueOnce(ok(`${summary(3)}${page(1, 3, "齊藤 壮馬")}`));

    const result = await audibleAdapter.fetchByActor(
      { canonicalName: "斉藤壮馬", searchNames: ["斉藤 壮馬"] },
      { snapshot: false },
    );

    expect(result.coverage?.matched).toBe(3);
  });

  it("検索に使わなかった canonicalName とも照合する", async () => {
    // 検索は空白入りの別名で通すが、作品側の表記は空白なしのことがある。
    // 照合対象は searchNames だけでなく canonicalName も含める
    fetchTextMock.mockResolvedValueOnce(ok(`${summary(2)}${page(1, 2, "上田麗奈")}`));

    const result = await audibleAdapter.fetchByActor(
      { canonicalName: "上田麗奈", searchNames: ["上田 麗奈"] },
      { snapshot: false },
    );

    expect(result.coverage?.matched).toBe(2);
  });

  it("実 HTML (佐藤元の検索結果) で本人名義が 0 件になる", async () => {
    fetchTextMock.mockResolvedValue(ok(looseMatchHtml));

    const result = await audibleAdapter.fetchByActor(
      { canonicalName: "佐藤元", searchNames: ["佐藤 元"] },
      { snapshot: false },
    );

    // ナレーターは佐藤恵・佐藤詩乃・佐藤弘樹・佐藤佑暉・佐藤慧・佐藤正宏。姓しか合っていない
    expect(result.works).toHaveLength(6);
    expect(result.coverage?.matched).toBe(0);
    expect(result.coverage?.total).toBeUndefined();
    expect(result.warnings.some((warning) => warning.startsWith("検索語が広すぎる"))).toBe(true);
  });

  it("実 HTML の同じ検索結果でも、佐藤恵で引いたなら本人名義として数える", async () => {
    // 一致率は「検索した声優が並んでいるか」だけを見ているので、
    // 同じ HTML でも対象の声優が変われば判定も変わる
    fetchTextMock.mockResolvedValue(ok(looseMatchHtml));

    const result = await audibleAdapter.fetchByActor(
      { canonicalName: "佐藤恵", searchNames: ["佐藤 恵"] },
      { snapshot: false },
    );

    expect(result.coverage?.matched).toBe(1);
  });

  // --- 実 HTML を使ったページングの筋 ------------------------------

  it("実 HTML の 1 ページ目と最終ページを含めて 164 件を網羅する", async () => {
    // 2026-09-19 の実測どおりの筋。斉藤壮馬は 9 ページで 164/164 (以前の並び順のはしごは 84/164)。
    // 1 ページ目と 9 ページ目は実 HTML、間の 7 ページは同じ形の 20 件で埋める
    fetchTextMock.mockResolvedValueOnce(ok(pagedFirstHtml));
    for (let index = 1; index <= 7; index += 1) {
      fetchTextMock.mockResolvedValueOnce(
        ok(`${summary(164)}${page(1 + index * 20, 20, "斉藤 壮馬")}`),
      );
    }
    fetchTextMock.mockResolvedValueOnce(ok(pagedLastHtml));

    const result = await audibleAdapter.fetchByActor(
      { canonicalName: "斉藤壮馬", searchNames: ["斉藤 壮馬"] },
      { snapshot: false },
    );

    expect(fetchTextMock.mock.calls.map((call) => call[0])).toEqual([
      buildSearchUrl("斉藤 壮馬"),
      ...Array.from({ length: 8 }, (_value, index) => buildSearchUrl("斉藤 壮馬", index + 2)),
    ]);
    expect(result.works).toHaveLength(164);
    expect(result.coverage).toEqual({
      fetched: 164,
      total: 164,
      complete: true,
      pages: 9,
      matched: 163,
    });
    // ページ間の重複は実測で 0 件。警告が出ていないことで確かめる
    expect(result.warnings.some((warning) => warning.includes("既出の作品"))).toBe(false);
    expect(result.warnings.some((warning) => warning.startsWith("網羅率"))).toBe(false);
  });

  it("実 HTML (上田麗奈 7 件) は 1 ページで終わり、2 ページ目を引かない", async () => {
    // このフィクスチャには総件数サマリが無い。7 件 = 1 ページが埋まっていないので、
    // 総件数を読めなくても「これで全部」と判断してよい
    fetchTextMock.mockResolvedValue(ok(searchHtml));

    const result = await audibleAdapter.fetchByActor(
      { canonicalName: "上田麗奈", searchNames: ["上田 麗奈"] },
      { snapshot: false },
    );

    expect(fetchTextMock).toHaveBeenCalledTimes(1);
    expect(fetchTextMock.mock.calls[0]?.[0]).toBe(buildSearchUrl("上田 麗奈"));
    expect(result.works).toHaveLength(7);
    expect(result.coverage).toEqual({ fetched: 7, total: 7, complete: true, pages: 1, matched: 7 });
  });

  it("該当なし (empty) でも網羅率は 0/0 として残す", async () => {
    fetchTextMock.mockResolvedValueOnce(emptyRedirect());

    const result = await audibleAdapter.fetchByActor(ACTOR, { snapshot: false });

    expect(result.status).toBe("empty");
    expect(result.coverage).toEqual({ fetched: 0, total: 0, complete: true, pages: 1, matched: 0 });
  });
});

describe("AUDIBLE_FEED_URLS", () => {
  /**
   * robots.txt は `/newreleases` を Disallow したうえで、許可する形を 1 本ずつ `$` 終端で
   * 列挙している (docs/stores/audible.md の「新着一覧」)。組み立て直すと字面から外れるので、
   * 定数がその列挙の形と一致していることをここで固定する
   */
  it("robots.txt が列挙している形と一致する", () => {
    const allowed = new Set([
      "/newreleases",
      "/newreleases?feature_six_browse-bin=8199814051&feature_twelve_browse-bin=8199774051&sort=pubdate-desc-rank&submitted=1",
      "/newreleases?feature_six_browse-bin=8199814051&feature_twelve_browse-bin=8199774051&sort=pubdate-asc-rank&submitted=1",
      "/newreleases?feature_six_browse-bin=8199814051&feature_twelve_browse-bin=8199774051&sort=title-asc-rank&submitted=1",
      "/newreleases?feature_six_browse-bin=8199814051&feature_twelve_browse-bin=8199774051&sort=title-desc-rank&submitted=1",
      "/newreleases?feature_six_browse-bin=8199814051&feature_twelve_browse-bin=8199774051&sort=review-rank&submitted=1",
      "/newreleases?feature_six_browse-bin=8199814051&feature_twelve_browse-bin=8199774051&sort=runtime-asc-rank&submitted=1",
      "/newreleases?feature_six_browse-bin=8199814051&feature_twelve_browse-bin=8199774051&submitted=1&page=2",
    ]);
    for (const url of AUDIBLE_FEED_URLS) {
      expect(url.startsWith("https://www.audible.co.jp")).toBe(true);
      expect(allowed).toContain(url.slice("https://www.audible.co.jp".length));
    }
  });

  it("列挙に無い page=1 と sort+page の併用を含まない", () => {
    for (const url of AUDIBLE_FEED_URLS) {
      expect(url).not.toContain("page=1");
      expect(url.includes("sort=") && url.includes("page=")).toBe(false);
    }
  });

  it("同じ URL を 2 度引かない", () => {
    expect(new Set(AUDIBLE_FEED_URLS).size).toBe(AUDIBLE_FEED_URLS.length);
  });
});

describe("parseSearchHtml (新着一覧)", () => {
  it("検索結果と同じセレクタで読め、配信日とナレーターが取れる", () => {
    const parsed = parseSearchHtml(newReleasesHtml, FETCHED_AT);
    // フィクスチャは 1 ページ 20 件のうち先頭 6 件を残したもの
    expect(parsed.works).toHaveLength(6);
    expect(parsed.invalidCount).toBe(0);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.works[0]).toMatchObject({
      storeSlug: "audible",
      storeProductId: "B0HJFGC6W1",
      titleRaw: "ハミングバードのいるところ",
      productUrl: "https://www.audible.co.jp/pd/B0HJFGC6W1",
      releaseDate: "2026-09-18",
      creditedNames: ["黒葛原 真奈"],
      storeCategory: "audiobook",
      // Audible は年齢区分を公開していない
      ageRating: "unknown",
    });
  });

  // 一覧に載らない作品があるので、照合できない作品がここで出る
  it("ナレーター欄が空の作品も一覧としては読める", () => {
    const parsed = parseSearchHtml(newReleasesPubdateDescHtml, FETCHED_AT);
    expect(parsed.works).toHaveLength(6);
    expect(parsed.works.every((work) => work.creditedNames.length === 0)).toBe(true);
  });

  it("新着枠の総件数を読める", () => {
    expect(parseTotalCount(newReleasesHtml)).toBe(112);
  });
});

describe("audibleAdapter.fetchNewReleases", () => {
  const fetchTextMock = vi.mocked(fetchText);

  /** 1 件の productListItem。ナレーターを空にもできる */
  function item(asin: string, narrator?: string): string {
    const narratorHtml =
      narrator === undefined ? "" : `<li class="narratorLabel"><a>${narrator}</a></li>`;
    return (
      `<li class="productListItem" id="product-list-item-${asin}">` +
      `<h3><a href="/pd/x/${asin}">Title ${asin}</a></h3>` +
      `<ul>${narratorHtml}</ul></li>`
    );
  }

  const feedPage = (html: string, total?: number): FetchResult => ({
    ok: true,
    status: 200,
    url: "https://www.audible.co.jp/newreleases",
    body:
      total === undefined
        ? html
        : `<span class="resultsSummarySubheading">検索結果 ${total}  のうち 1 - 20 件</span>${html}`,
  });

  afterEach(() => {
    fetchTextMock.mockReset();
  });

  it("列挙した URL だけを、定数のまま引く", async () => {
    fetchTextMock.mockResolvedValue(feedPage(item("B000000001", "上田 麗奈")));

    await audibleAdapter.fetchNewReleases?.({ snapshot: false });

    expect(fetchTextMock.mock.calls.map((call) => call[0])).toEqual([...AUDIBLE_FEED_URLS]);
  });

  it("並び順違いの結果を ASIN で畳む", async () => {
    fetchTextMock.mockImplementation(async (url: string) =>
      feedPage(
        url.includes("title-asc")
          ? item("B000000002", "上田 麗奈")
          : item("B000000001", "上田 麗奈"),
      ),
    );

    const result = await audibleAdapter.fetchNewReleases?.({ snapshot: false });

    expect(result?.works.map((work) => work.storeProductId)).toEqual(["B000000001", "B000000002"]);
    expect(result?.listedCount).toBe(2);
    expect(result?.pages).toBe(AUDIBLE_FEED_URLS.length);
    expect(result?.complete).toBe(true);
  });

  /**
   * 誰の作品か決められないので送らない。取り込み側に送っても捨てられるだけで、
   * 「対象声優が居ない」と混ざって理由が読めなくなる
   */
  it("ナレーター欄が空の作品は送らず、件数を警告に出す", async () => {
    fetchTextMock.mockResolvedValue(
      feedPage(`${item("B000000001", "上田 麗奈")}${item("B000000002")}`),
    );

    const result = await audibleAdapter.fetchNewReleases?.({ snapshot: false });

    expect(result?.works.map((work) => work.storeProductId)).toEqual(["B000000001"]);
    // 一覧に出た数は落とす前の数
    expect(result?.listedCount).toBe(2);
    expect(result?.warnings).toContain(
      "ナレーター欄が空の新着 1 件を送らなかった (月次の補完で拾う)",
    );
  });

  it("既知の作品は送らない", async () => {
    fetchTextMock.mockResolvedValue(
      feedPage(`${item("B000000001", "上田 麗奈")}${item("B000000002", "上田 麗奈")}`),
    );

    const result = await audibleAdapter.fetchNewReleases?.({
      knownIds: new Set(["B000000001"]),
      snapshot: false,
    });

    expect(result?.works.map((work) => work.storeProductId)).toEqual(["B000000002"]);
    expect(result?.listedCount).toBe(2);
  });

  it("送るものが無ければ empty で返す", async () => {
    fetchTextMock.mockResolvedValue(feedPage(item("B000000001")));

    const result = await audibleAdapter.fetchNewReleases?.({ snapshot: false });

    expect(result?.status).toBe("empty");
    expect(result?.works).toEqual([]);
  });

  // 新着枠を 1 日で覆い切れないことがある。取りこぼしは翌日以降の別の並びで拾い直す
  it("新着枠を覆い切れなければ、取れた件数を警告に出す", async () => {
    fetchTextMock.mockResolvedValue(feedPage(item("B000000001", "上田 麗奈"), 112));

    const result = await audibleAdapter.fetchNewReleases?.({ snapshot: false });

    expect(result?.warnings).toContain("新着枠 112 件のうち 1 件を取得");
    // 総件数は送らない。枠の大半は対象声優と関係ない作品で、保存件数と並べると読み違える
    expect(result?.totalCount).toBeUndefined();
  });

  it("一部の並びが落ちても、取れた側で続行して警告に残す", async () => {
    let first = true;
    fetchTextMock.mockImplementation(async () => {
      if (first) {
        first = false;
        return { ok: false, url: "https://www.audible.co.jp/newreleases", reason: "timeout" };
      }
      return feedPage(item("B000000001", "上田 麗奈"));
    });

    const result = await audibleAdapter.fetchNewReleases?.({ snapshot: false });

    expect(result?.status).toBe("ok");
    expect(result?.works).toHaveLength(1);
    expect(result?.pages).toBe(AUDIBLE_FEED_URLS.length - 1);
    expect(result?.complete).toBe(false);
    expect(result?.warnings).toContain("新着一覧を 1 本取れなかった (timeout)");
  });

  it("どれも引けなければ error にする", async () => {
    fetchTextMock.mockResolvedValue({
      ok: false,
      url: "https://www.audible.co.jp/newreleases",
      reason: "timeout",
    });

    const result = await audibleAdapter.fetchNewReleases?.({ snapshot: false });

    expect(result?.status).toBe("error");
    expect(result?.complete).toBe(false);
    expect(result?.reason).toBe("新着一覧の取得に失敗 (timeout)");
  });
});
