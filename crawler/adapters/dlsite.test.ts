import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchResult } from "../lib/fetch.ts";
import { FIXTURES_DIR } from "../lib/paths.ts";
import {
  applyProductDetail,
  buildProductJsonUrl,
  buildSearchUrl,
  dlsiteAdapter,
  parsePagerCount,
  parseProductJson,
  parseSearchHtml,
} from "./dlsite.ts";

// fetchByActor の分岐 (古い順での補完) だけをネットワーク無しで確かめるための差し替え。
// 解析そのものは上のフィクスチャ側のテストで見ている (設計書 §8: 素の fetch は呼ばない)
vi.mock("../lib/fetch.ts", () => ({ fetchText: vi.fn() }));
const { fetchText } = await import("../lib/fetch.ts");
const fetchTextMock = vi.mocked(fetchText);

/**
 * 実際に取得した HTML / JSON (crawler/fixtures/) に対する固定テスト。
 * DLsite の HTML 構造が変わったらここが落ちる。ネットワークには出ない (設計書 §8)
 */

const FETCHED_AT = "2026-09-18T00:00:00.000Z";
const searchHtml = readFileSync(path.join(FIXTURES_DIR, "dlsite-search-ueda-reina.html"), "utf8");
const productJson = readFileSync(path.join(FIXTURES_DIR, "dlsite-product-RJ01698658.json"), "utf8");
/** `creaters.voice_by[].name` に複数人が縦棒で詰まっている形の product.json */
const multiVoiceProductJson = readFileSync(
  path.join(FIXTURES_DIR, "dlsite-product-multi-voice.json"),
  "utf8",
);

describe("buildSearchUrl", () => {
  it("名前をダブルクォートで囲んで完全一致検索にする", () => {
    // %22 がダブルクォート。robots.txt が許すのは page/1 のみ
    expect(buildSearchUrl("上田麗奈")).toBe(
      "https://www.dlsite.com/home/fsr/=/language/jp/keyword_creater/" +
        "%22%E4%B8%8A%E7%94%B0%E9%BA%97%E5%A5%88%22" +
        "/work_type_category[0]/audio/order/release_d/page/1",
    );
  });

  it("古い順は order/release だけが変わる", () => {
    expect(buildSearchUrl("上田麗奈", "release")).toBe(
      "https://www.dlsite.com/home/fsr/=/language/jp/keyword_creater/" +
        "%22%E4%B8%8A%E7%94%B0%E9%BA%97%E5%A5%88%22" +
        "/work_type_category[0]/audio/order/release/page/1",
    );
  });
});

describe("parsePagerCount", () => {
  it("フィクスチャの埋め込み JSON から総件数を取る", () => {
    expect(parsePagerCount(searchHtml)).toBe(27);
  });

  it("count が have_to_paginate より後ろにあっても取れる", () => {
    // pager の中のキーの並び順は保証されていないので、順序に依存しないことを確かめる
    expect(parsePagerCount('a = {"pager":{"have_to_paginate":true,"count":42,"page":1}};')).toBe(
      42,
    );
  });

  it("count が先頭にあっても取れる", () => {
    expect(parsePagerCount('a = {"pager":{"count":3,"have_to_paginate":false}};')).toBe(3);
  });

  it("pager が無ければ undefined", () => {
    expect(parsePagerCount("<html><body></body></html>")).toBeUndefined();
    expect(parsePagerCount('{"count":10}')).toBeUndefined();
  });

  it("別のオブジェクトの count は拾わない", () => {
    // pager の { } を閉じた後の count に引きずられないこと
    expect(parsePagerCount('{"pager":{"page":1},"other":{"count":99}}')).toBeUndefined();
  });
});

describe("buildProductJsonUrl", () => {
  it("workno を 1 件だけ渡す", () => {
    expect(buildProductJsonUrl("RJ01698658")).toBe(
      "https://www.dlsite.com/home/api/=/product.json?workno=RJ01698658",
    );
  });
});

describe("parseSearchHtml", () => {
  const parsed = parseSearchHtml(searchHtml, FETCHED_AT);

  it("検索結果 1 ページ目の全作品を取り、検証落ちが無い", () => {
    expect(parsed.works).toHaveLength(27);
    expect(parsed.invalidCount).toBe(0);
    expect(parsed.warnings).toEqual([]);
  });

  it("埋め込み JSON の総件数を totalCount に載せる", () => {
    // 上田麗奈は全期間 27 件。1 ページ目だけで取り切れている (設計書 §13)
    expect(parsed.totalCount).toBe(27);
  });

  it("先頭の作品から一覧に載っている項目を取る", () => {
    expect(parsed.works[0]).toEqual({
      storeSlug: "dlsite",
      storeProductId: "RJ01698658",
      titleRaw:
        "【安眠ASMR】精霊介護~Spirit“s” lullaby~ ノワール編 CV.上田麗奈【耳かき・マッサージ・子守唄】",
      productUrl: "https://www.dlsite.com/home/work/=/product_id/RJ01698658.html",
      coverImageUrl:
        "https://img.dlsite.jp/modpub/images2/work/doujin/RJ01699000/RJ01698658_img_main.jpg",
      price: 1584,
      listPrice: 1980,
      makerName: "Bit grooove lab.",
      creditedNames: ["上田麗奈"],
      storeCategory: "SOU",
      adult: false,
      fetchedAt: FETCHED_AT,
      // 一覧に発売日は無い (設計書 §3)。product.json で補う
      releaseDate: undefined,
    });
  });

  it("セールでない作品は定価を持たない", () => {
    const withoutSale = parsed.works.find((work) => work.storeProductId === "RJ01690162");
    expect(withoutSale?.price).toBe(1980);
    expect(withoutSale?.listPrice).toBeUndefined();
  });

  it("すべての作品が ID・タイトル・商品 URL を持つ", () => {
    for (const work of parsed.works) {
      expect(work.storeProductId).toMatch(/^RJ\d+$/);
      expect(work.titleRaw.length).toBeGreaterThan(0);
      expect(work.productUrl).toContain(work.storeProductId);
    }
  });
});

describe("parseProductJson", () => {
  const detail = parseProductJson(productJson);

  it("発売日・年齢区分・声優・ジャンルを取る", () => {
    expect(detail).toEqual({
      workno: "RJ01698658",
      workName:
        "【安眠ASMR】精霊介護~Spirit“s” lullaby~ ノワール編 CV.上田麗奈【耳かき・マッサージ・子守唄】",
      makerName: "Bit grooove lab.",
      releaseDate: "2026-08-22",
      ageCategory: 1,
      workType: "SOU",
      price: 1584,
      officialPrice: 1980,
      voiceNames: ["上田麗奈"],
      genres: [
        "ASMR",
        "癒し",
        "健全",
        "バイノーラル/ダミヘ",
        "ファンタジー",
        "マッサージ",
        "耳かき",
      ],
    });
  });

  /**
   * DLsite は 1 つの `name` に複数人を縦棒で詰めてくることがある。
   * 分割しないと誰にも名寄せできず、未解決クレジットに積み上がる
   */
  it("voice_by の name が「|」区切りなら分割して全員を拾う", () => {
    const multi = parseProductJson(multiVoiceProductJson);

    expect(multi?.voiceNames).toEqual(["上田麗奈", "石見舞菜香", "鬼頭明里"]);
  });

  it("JSON として読めない本文では undefined を返す", () => {
    expect(parseProductJson("<html>error</html>")).toBeUndefined();
  });

  it("空配列では undefined を返す", () => {
    expect(parseProductJson("[]")).toBeUndefined();
  });
});

describe("applyProductDetail", () => {
  it("一覧の作品に発売日と声優全員を補う", () => {
    const listWork = parseSearchHtml(searchHtml, FETCHED_AT).works[0];
    const detail = parseProductJson(productJson);
    expect(listWork).toBeDefined();
    expect(detail).toBeDefined();
    if (listWork === undefined || detail === undefined) return;

    const merged = applyProductDetail(listWork, detail);
    expect(merged.releaseDate).toBe("2026-08-22");
    expect(merged.creditedNames).toEqual(["上田麗奈"]);
    expect(merged.genres).toContain("ASMR");
    expect(merged.storeCategory).toBe("SOU");
  });

  it("voice_by が空なら一覧の声優名を残す", () => {
    const listWork = parseSearchHtml(searchHtml, FETCHED_AT).works[0];
    if (listWork === undefined) throw new Error("fixture が空");
    const merged = applyProductDetail(listWork, {
      workno: listWork.storeProductId,
      voiceNames: [],
      genres: [],
      releaseDate: "2020-01-01",
    });
    expect(merged.creditedNames).toEqual(["上田麗奈"]);
    expect(merged.releaseDate).toBe("2020-01-01");
  });
});

// --- fetchByActor の網羅率と補完 --------------------------------------------

/** 検索一覧の最小限の HTML。`total` を渡すと総件数の埋め込み JSON も付ける */
function searchPage(ids: readonly string[], total?: number): string {
  const items = ids
    .map(
      (id) =>
        `<li data-list_item_product_id="${id}"><dl><dd class="work_name">` +
        `<a href="https://www.dlsite.com/home/work/=/product_id/${id}.html" title="作品 ${id}">作品 ${id}</a>` +
        "</dd></dl></li>",
    )
    .join("");
  const pager =
    total === undefined
      ? ""
      : `<script>window['x'] = {"url":"u","pager":{"have_to_paginate":true,"count":${total},"page":1}};</script>`;
  return `<html><body><ul id="search_result_img_box">${items}</ul>${pager}</body></html>`;
}

function ok(body: string): FetchResult {
  return { ok: true, status: 200, url: "https://www.dlsite.com/", body };
}

const ACTOR = { canonicalName: "上田麗奈", searchNames: ["上田麗奈"] };
/** 一覧に出た作品すべてを既知として渡し、product.json の取得を起こさない (検索の回数だけを見る) */
const skipAll = (ids: readonly string[]) => ({ skipKnownIds: new Set(ids), snapshot: false });

describe("dlsiteAdapter.fetchByActor の網羅率", () => {
  beforeEach(() => {
    fetchTextMock.mockReset();
  });

  it("総件数ぶん取れていれば古い順の追加リクエストを出さない", async () => {
    fetchTextMock.mockResolvedValueOnce(ok(searchPage(["RJ1", "RJ2"], 2)));

    const result = await dlsiteAdapter.fetchByActor(ACTOR, skipAll(["RJ1", "RJ2"]));

    expect(fetchTextMock).toHaveBeenCalledTimes(1);
    expect(result.coverage).toEqual({ fetched: 2, total: 2, complete: true, pages: 1 });
    expect(result.totalCount).toBe(2);
    expect(result.warnings).toEqual([]);
  });

  it("総件数に届かなければ古い順の 1 ページ目を足して和集合を取る", async () => {
    fetchTextMock
      .mockResolvedValueOnce(ok(searchPage(["RJ1", "RJ2"], 3)))
      // 古い順は重複 (RJ2) を含む。ID で束ねるので 3 件になる
      .mockResolvedValueOnce(ok(searchPage(["RJ3", "RJ2"], 3)));

    const result = await dlsiteAdapter.fetchByActor(ACTOR, skipAll(["RJ1", "RJ2", "RJ3"]));

    expect(fetchTextMock).toHaveBeenCalledTimes(2);
    expect(fetchTextMock.mock.calls[1]?.[0]).toBe(buildSearchUrl("上田麗奈", "release"));
    expect(result.works.map((work) => work.storeProductId)).toEqual(["RJ1", "RJ2", "RJ3"]);
    expect(result.coverage).toEqual({ fetched: 3, total: 3, complete: true, pages: 2 });
    expect(result.warnings).toEqual([]);
  });

  it("2 通りの並び順でも足りなければ網羅率を警告に積む", async () => {
    fetchTextMock
      .mockResolvedValueOnce(ok(searchPage(["RJ1"], 40)))
      .mockResolvedValueOnce(ok(searchPage(["RJ2"], 40)));

    const result = await dlsiteAdapter.fetchByActor(ACTOR, skipAll(["RJ1", "RJ2"]));

    expect(result.coverage).toEqual({ fetched: 2, total: 40, complete: false, pages: 2 });
    expect(result.warnings).toContain("網羅率 2/40");
  });

  it("古い順の取得に失敗しても新しい順の結果で続行する", async () => {
    fetchTextMock
      .mockResolvedValueOnce(ok(searchPage(["RJ1"], 40)))
      .mockResolvedValueOnce({ ok: false, url: "https://www.dlsite.com/", reason: "HTTP 503" });

    const result = await dlsiteAdapter.fetchByActor(ACTOR, skipAll(["RJ1"]));

    expect(result.status).toBe("ok");
    expect(result.works).toHaveLength(1);
    expect(result.coverage).toEqual({ fetched: 1, total: 40, complete: false, pages: 1 });
    expect(result.warnings).toContain("古い順での補完に失敗 (HTTP 503)。新しい順の結果だけで続行");
    expect(result.warnings).toContain("網羅率 1/40");
  });

  it("総件数を読めなければ complete を立てず、追加リクエストも出さない", async () => {
    fetchTextMock.mockResolvedValueOnce(ok(searchPage(["RJ1"])));

    const result = await dlsiteAdapter.fetchByActor(ACTOR, skipAll(["RJ1"]));

    expect(fetchTextMock).toHaveBeenCalledTimes(1);
    expect(result.coverage).toEqual({ fetched: 1, pages: 1 });
    expect(result.totalCount).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  it("検索そのものに失敗したら error で coverage は残さない", async () => {
    fetchTextMock.mockResolvedValueOnce({
      ok: false,
      url: "https://www.dlsite.com/",
      reason: "timeout",
    });

    const result = await dlsiteAdapter.fetchByActor(ACTOR, skipAll([]));

    expect(result.status).toBe("error");
    expect(result.coverage).toBeUndefined();
  });
});
