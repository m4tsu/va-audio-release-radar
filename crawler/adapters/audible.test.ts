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
  SORT_LADDER,
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
// ヒット 1 件の実 HTML。総件数サマリの表記が複数件のときと違う (T22-C)
const singleHitHtml = readFileSync(
  path.join(FIXTURES_DIR, "audible-search-genda-tesshou.html"),
  "utf8",
);
// searchNarrator= が姓だけでも一致する実 HTML。総件数 355 に対し本人名義は 0 件 (T22-D)
const looseMatchHtml = readFileSync(
  path.join(FIXTURES_DIR, "audible-search-sato-hajime.html"),
  "utf8",
);

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

describe("SORT_LADDER", () => {
  it("新しい順から始まり、同じキーの昇順が 2 番目に来る", () => {
    // 1 番目が新作レーダーの本体。2 番目を同じキー (pubdate) の逆向きにすると、
    // 「上位 20 件」と「下位 20 件」で必ず重ならないので、総件数 40 以下は定義上 全件取れる (T22)
    expect(SORT_LADDER[0]).toBe("pubdate-desc-rank");
    expect(SORT_LADDER[1]).toBe("pubdate-asc-rank");
  });

  it("並び順は重複せず、上限は 6 リクエスト", () => {
    // 10 種すべて使っても実測 (斉藤壮馬 164 件) では 6 種の 83 件から 84 件にしか増えない。
    // 声優 1 人あたりの所要時間に見合わないので 6 で打ち切る
    expect(new Set(SORT_LADDER).size).toBe(SORT_LADDER.length);
    expect(SORT_LADDER).toHaveLength(6);
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

  it("ヒットが 1 件のときの別表記からも総件数を取る", () => {
    // 500 人のクロールで総件数を読めなかった 73 件は全部これ。1 件のときだけ
    // 「のうち」が出ず、実 HTML では「検索結果 1 件」とだけ書かれる (T22-C)
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
  function htmlWithOneWork(asin: string, narrator = "上田 麗奈"): string {
    // ナレーター欄を入れるのは、本人名義かどうかの一致率を測るため (T22-D)。
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

  // --- 網羅率と並び順のはしご (T12 / T22) ---------------------------------

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

  it("総件数が 1 ページに収まるなら追加の並び順を引かない", async () => {
    fetchTextMock.mockResolvedValueOnce(ok(`${summary(7)}${page(1, 7)}`));

    const result = await audibleAdapter.fetchByActor(ACTOR, { snapshot: false });

    expect(fetchTextMock).toHaveBeenCalledTimes(1);
    expect(result.coverage).toEqual({ fetched: 7, total: 7, complete: true, pages: 1, matched: 7 });
  });

  it("総件数が 1 ページに収まるなら、取得件数が足りなくても引き直さない", async () => {
    // ページングが起きていないので、どの並び順を引いても同じ 1 ページが返る。
    // 解析落ちで件数が合わないときに 5 回引き直しても、相手に負荷をかけるだけで増えない
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
    // 総件数 21。新しい順で 20 件、古い順で 1 件足りれば 21 件に届くので 3 種類目は引かない
    fetchTextMock
      .mockResolvedValueOnce(ok(`${summary(21)}${page(1)}`))
      .mockResolvedValueOnce(ok(`${summary(21)}${page(21, 1)}`));

    const result = await audibleAdapter.fetchByActor(ACTOR, { snapshot: false });

    expect(fetchTextMock).toHaveBeenCalledTimes(2);
    expect(fetchTextMock.mock.calls[1]?.[0]).toBe(buildSearchUrl("上田麗奈", "pubdate-asc-rank"));
    expect(result.coverage).toEqual({
      fetched: 21,
      total: 21,
      complete: true,
      pages: 2,
      matched: 21,
    });
    expect(result.warnings).toEqual([]);
  });

  it("重複した ASIN は畳んで 1 件にする", async () => {
    // 総件数 30 に届かないのではしごを使い切るが、3 種類目以降は既出の ASIN しか返さない
    fetchTextMock
      .mockResolvedValueOnce(
        ok(`${summary(30)}${htmlWithOneWork("B000000011")}${htmlWithOneWork("B000000012")}`),
      )
      .mockResolvedValue(
        ok(`${summary(30)}${htmlWithOneWork("B000000012")}${htmlWithOneWork("B000000013")}`),
      );

    const result = await audibleAdapter.fetchByActor(ACTOR, { snapshot: false });

    expect(result.works.map((work) => work.storeProductId)).toEqual([
      "B000000011",
      "B000000012",
      "B000000013",
    ]);
    expect(result.coverage).toEqual({
      fetched: 3,
      total: 30,
      complete: false,
      pages: 6,
      matched: 3,
    });
  });

  it("届かないときは SORT_LADDER を使い切って打ち切る", async () => {
    // 総件数 164 (斉藤壮馬の実測値)。並び順ごとに別の 20 件が返っても 6 種類で止める
    for (let index = 0; index < SORT_LADDER.length; index += 1) {
      fetchTextMock.mockResolvedValueOnce(ok(`${summary(164)}${page(1 + index * 20)}`));
    }

    const result = await audibleAdapter.fetchByActor(ACTOR, { snapshot: false });

    expect(fetchTextMock).toHaveBeenCalledTimes(SORT_LADDER.length);
    expect(fetchTextMock.mock.calls.map((call) => call[0])).toEqual(
      SORT_LADDER.map((sort) => buildSearchUrl("上田麗奈", sort)),
    );
    expect(result.coverage).toEqual({
      fetched: 120,
      total: 164,
      complete: false,
      pages: 6,
      matched: 120,
    });
    expect(result.warnings).toContain("網羅率 120/164");
  });

  it("途中の並び順が失敗したら、そこまでの結果で打ち切る", async () => {
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
    expect(
      result.warnings.some((warning) =>
        warning.startsWith("並び順 pubdate-asc-rank での補完に失敗"),
      ),
    ).toBe(true);
  });

  it("1 ページ目で総件数を読めなくても、後続の並び順で読めれば拾う", async () => {
    // 1 ページ目が埋まっていれば続きがあると分かるので、総件数不明でもはしごを進める
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

  // --- 総件数を読めなかったときの扱い (T22-C) -----------------------------

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

  it("総件数が読めないまま最後まで埋まっていたら「不明」のままにする", async () => {
    // ちょうど 20 件で総件数も読めない。続きがあるかどうか分からないので complete を立てない
    for (let index = 0; index < SORT_LADDER.length; index += 1) {
      fetchTextMock.mockResolvedValueOnce(ok(page(1)));
    }

    const result = await audibleAdapter.fetchByActor(ACTOR, { snapshot: false });

    expect(fetchTextMock).toHaveBeenCalledTimes(SORT_LADDER.length);
    expect(result.coverage).toEqual({ fetched: 20, pages: 6, matched: 20 });
    expect(result.totalCount).toBeUndefined();
  });

  it("検証落ちを引いた分は「1 ページが埋まっていない」の判定に入れない", async () => {
    // 1 ページ 20 件のうち 1 件が検証に落ちる (ここでは表紙がプレースホルダ画像で https URL でない)
    // と works は 19 件になるが、ページングは起きている。works の数で判断すると
    // 「20 件未満だから全件」と誤るので、捨てた分を数に戻してから判定する
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

  // --- 検索語が広すぎるときの扱い (T22-D) --------------------------------

  it("本人が 1 件もクレジットされていなければ、総件数を分母にしない", async () => {
    // 実測: 「佐藤 元」で引くと総件数 355 件が返るが、1 ページ目のナレーターは
    // 佐藤恵・佐藤詩乃・佐藤弘樹などで佐藤元は 1 件も含まれない。
    // この 355 は佐藤姓のナレーター作品の総数であって、佐藤元の作品数ではない
    for (let index = 0; index < SORT_LADDER.length; index += 1) {
      fetchTextMock.mockResolvedValueOnce(ok(`${summary(355)}${page(1, 20, "佐藤 恵")}`));
    }

    const result = await audibleAdapter.fetchByActor(
      { canonicalName: "佐藤元", searchNames: ["佐藤 元"] },
      { snapshot: false },
    );

    // total も complete も落として「不明」にする。complete: false にすると
    // 「佐藤元の作品を取り逃した」という別の主張になってしまう
    expect(result.coverage).toEqual({ fetched: 20, pages: 6, matched: 0 });
    expect(result.totalCount).toBeUndefined();
    expect(result.warnings).toContain(
      "検索語が広すぎる可能性 (本人名義 0/20 件)。総件数 355 は同姓の別人を含むとみて網羅率は不明とする",
    );
    // 網羅率の警告は鳴らさない。分母が信用できないものを取りこぼしとして出し続けても意味がない
    expect(result.warnings.some((warning) => warning.startsWith("網羅率"))).toBe(false);
  });

  it("本人名義が大半なら、1 件混ざっても網羅率をそのまま出す", async () => {
    // 斉藤壮馬は和集合 84 件中 83 件が本人名義。残り 1 件は本人の冠番組でナレーター欄が空。
    // この程度の混入で分母を捨てると、正しく引けている声優の網羅率まで見えなくなる
    const own = page(1, 19, "斉藤 壮馬");
    const other = htmlWithOneWork("B000000099", "別人 太郎");
    for (let index = 0; index < SORT_LADDER.length; index += 1) {
      fetchTextMock.mockResolvedValueOnce(ok(`${summary(164)}${own}${other}`));
    }

    const result = await audibleAdapter.fetchByActor(
      { canonicalName: "斉藤壮馬", searchNames: ["斉藤 壮馬"] },
      { snapshot: false },
    );

    expect(result.coverage).toEqual({
      fetched: 20,
      total: 164,
      complete: false,
      pages: 6,
      matched: 19,
    });
    expect(result.warnings).toContain("網羅率 20/164");
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

  it("該当なし (empty) でも網羅率は 0/0 として残す", async () => {
    fetchTextMock.mockResolvedValueOnce(emptyRedirect());

    const result = await audibleAdapter.fetchByActor(ACTOR, { snapshot: false });

    expect(result.status).toBe("empty");
    expect(result.coverage).toEqual({ fetched: 0, total: 0, complete: true, pages: 1, matched: 0 });
  });
});
