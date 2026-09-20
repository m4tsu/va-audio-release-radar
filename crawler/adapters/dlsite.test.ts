import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchResult } from "../lib/fetch.ts";
import { FIXTURES_DIR } from "../lib/paths.ts";
import {
  applyProductDetail,
  buildProductJsonUrl,
  buildProductUrl,
  buildSearchUrl,
  DLSITE_FLOORS,
  type DlsiteFloor,
  dlsiteAdapter,
  parsePagerCount,
  parseProductJson,
  parseSearchHtml,
  toAgeRating,
} from "./dlsite.ts";

// fetchByActor の分岐 (古い順での補完) だけをネットワーク無しで確かめるための差し替え。
// 解析そのものは上のフィクスチャ側のテストで見ている (素の fetch は呼ばない)
vi.mock("../lib/fetch.ts", () => ({ fetchText: vi.fn() }));
const { fetchText } = await import("../lib/fetch.ts");
const fetchTextMock = vi.mocked(fetchText);

/**
 * 実際に取得した HTML / JSON (crawler/fixtures/) に対する固定テスト。
 * DLsite の HTML 構造が変わったらここが落ちる。ネットワークには出ない
 */

const FETCHED_AT = "2026-09-18T00:00:00.000Z";
const searchHtml = readFileSync(path.join(FIXTURES_DIR, "dlsite-search-ueda-reina.html"), "utf8");
/** `/garumani/` の一覧。`/home/` と同じセレクタで読めることを確かめるためのもの */
const garumaniSearchHtml = readFileSync(
  path.join(FIXTURES_DIR, "dlsite-search-garumani-saito-souma.html"),
  "utf8",
);
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

  it("フロアはパスの先頭だけが変わる", () => {
    expect(buildSearchUrl("上田麗奈", "release_d", "garumani")).toBe(
      "https://www.dlsite.com/garumani/fsr/=/language/jp/keyword_creater/" +
        "%22%E4%B8%8A%E7%94%B0%E9%BA%97%E5%A5%88%22" +
        "/work_type_category[0]/audio/order/release_d/page/1",
    );
  });
});

describe("buildProductUrl", () => {
  it("引いたフロアの商品 URL を組み立てる", () => {
    expect(buildProductUrl("RJ01698658")).toBe(
      "https://www.dlsite.com/home/work/=/product_id/RJ01698658.html",
    );
    expect(buildProductUrl("BJ01234567", "garumani")).toBe(
      "https://www.dlsite.com/garumani/work/=/product_id/BJ01234567.html",
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
    // 上田麗奈は全期間 27 件。1 ページ目だけで取り切れている
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
      makerName: "Bit grooove lab.",
      creditedNames: ["上田麗奈"],
      storeCategory: "SOU",
      // /home/ の一覧なので全年齢。区分は product.json で上書きされる
      ageRating: "general",
      // ストア区分は一覧からは決まらない。product.json の site_id でだけ埋まる
      storeSection: undefined,
      fetchedAt: FETCHED_AT,
      // 一覧に発売日は無い。product.json で補う
      releaseDate: undefined,
    });
  });

  it("すべての作品が ID・タイトル・商品 URL を持つ", () => {
    for (const work of parsed.works) {
      expect(work.storeProductId).toMatch(/^RJ\d+$/);
      expect(work.titleRaw.length).toBeGreaterThan(0);
      expect(work.productUrl).toContain(work.storeProductId);
    }
  });
});

describe("parseSearchHtml (/garumani/ の一覧)", () => {
  const parsed = parseSearchHtml(garumaniSearchHtml, FETCHED_AT, "garumani");

  it("`/home/` と同じセレクタで読め、検証落ちが無い", () => {
    // フィクスチャは 1 ページ目 30 件のうち先頭 5 件を残したもの
    expect(parsed.works).toHaveLength(5);
    expect(parsed.invalidCount).toBe(0);
    expect(parsed.warnings).toEqual([]);
    // 総件数は切り詰める前の 1 ページ目の埋め込み JSON がそのまま入っている
    expect(parsed.totalCount).toBe(52);
  });

  it("先頭の作品から一覧に載っている項目を取る", () => {
    expect(parsed.works[0]).toEqual({
      storeSlug: "dlsite",
      storeProductId: "BJ02860641",
      titleRaw: "恋地獄で待つ（出演：斉藤壮馬、大塚剛央）※特典トラック付き",
      productUrl: "https://www.dlsite.com/garumani/work/=/product_id/BJ02860641.html",
      coverImageUrl:
        "https://img.dlsite.jp/modpub/images2/work/books/BJ02861000/BJ02860641_img_main.jpg",
      makerName: "フィフスアベニュー",
      // 一覧の span.author は代表 1 名。出演者全員は product.json で補う
      creditedNames: ["斉藤壮馬"],
      storeCategory: "SOU",
      // フロア全体が全年齢。区分は product.json の age_category で上書きされる
      ageRating: "general",
      // 引いたフロアは作品の所属ではないので入れない
      storeSection: undefined,
      fetchedAt: FETCHED_AT,
      releaseDate: undefined,
    });
  });

  it("商業 (BJ) の作品が並ぶ", () => {
    // `/home/` にはこの形の ID が出ない (docs/decisions/0011-dlsite-garumani-floor.md)
    for (const work of parsed.works) {
      expect(work.storeProductId).toMatch(/^BJ\d+$/);
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
      siteId: "home",
      workType: "SOU",
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

  // `/garumani/` の一覧には発売日が未来の予約作品が出る (docs/stores/dlsite.md の「既知の落とし穴」)。
  // 上限を置かずそのまま通す
  it("発売日が未来でもそのまま入れる", () => {
    const listWork = parseSearchHtml(garumaniSearchHtml, FETCHED_AT, "garumani").works[0];
    if (listWork === undefined) throw new Error("fixture が空");

    const merged = applyProductDetail(listWork, {
      workno: listWork.storeProductId,
      voiceNames: [],
      genres: [],
      releaseDate: "2099-12-31",
    });
    expect(merged.releaseDate).toBe("2099-12-31");
  });

  it("age_category と site_id から年齢区分とストア区分を入れる", () => {
    const listWork = parseSearchHtml(searchHtml, FETCHED_AT).works[0];
    if (listWork === undefined) throw new Error("fixture が空");

    const merged = applyProductDetail(listWork, {
      workno: listWork.storeProductId,
      voiceNames: [],
      genres: [],
      ageCategory: 3,
      siteId: "maniax",
    });
    expect(merged.ageRating).toBe("r18");
    expect(merged.storeSection).toBe("maniax");
  });

  // ストア区分を決めるのは site_id だけ。引いたフロア (garumani) は入らない
  it("ストア区分は site_id からだけ入る", () => {
    const listWork = parseSearchHtml(garumaniSearchHtml, FETCHED_AT, "garumani").works[0];
    if (listWork === undefined) throw new Error("fixture が空");
    expect(listWork.storeSection).toBeUndefined();

    const merged = applyProductDetail(listWork, {
      workno: listWork.storeProductId,
      voiceNames: [],
      genres: [],
      siteId: "bldrama",
    });
    expect(merged.storeSection).toBe("bldrama");
  });

  // 詳細が取れなかったことを理由に、一覧から分かっている事実まで捨てない
  it("age_category が無ければ一覧由来の年齢区分を残す", () => {
    const listWork = parseSearchHtml(searchHtml, FETCHED_AT).works[0];
    if (listWork === undefined) throw new Error("fixture が空");

    const merged = applyProductDetail(listWork, {
      workno: listWork.storeProductId,
      voiceNames: [],
      genres: [],
    });
    expect(merged.ageRating).toBe("general");
    // site_id が無ければストア区分は空のまま。ingest 側で既存の値が残る
    expect(merged.storeSection).toBeUndefined();
  });
});

describe("toAgeRating", () => {
  it("1 だけが全年齢で、それ以外は r18 に寄せる", () => {
    expect(toAgeRating(1)).toBe("general");
    expect(toAgeRating(2)).toBe("r18");
    expect(toAgeRating(3)).toBe("r18");
  });

  // 区分が読めなかった作品を「全年齢」と言い切らない
  it("区分が無ければ unknown", () => {
    expect(toAgeRating(undefined)).toBe("unknown");
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

  /**
   * フロアごとに返すものを決める。引く順は `DLSITE_FLOORS` だが、テストは URL で見分けるので
   * 並びが変わっても壊れない。渡さなかったフロアは「0 件・総件数 0」を返す
   */
  function respondByFloor(
    pages: Partial<Record<DlsiteFloor, { newest: FetchResult; oldest?: FetchResult }>>,
  ) {
    fetchTextMock.mockImplementation(async (url: string) => {
      const floor = DLSITE_FLOORS.find((name) => url.includes(`/${name}/fsr/`));
      const page = floor === undefined ? undefined : pages[floor];
      if (page === undefined) return ok(searchPage([], 0));
      return url.includes("/order/release/") ? (page.oldest ?? ok(searchPage([], 0))) : page.newest;
    });
  }

  it("両方のフロアを引き、作品を 1 つにまとめる", async () => {
    respondByFloor({
      home: { newest: ok(searchPage(["RJ1"], 1)) },
      garumani: { newest: ok(searchPage(["BJ1", "BJ2"], 2)) },
    });

    const result = await dlsiteAdapter.fetchByActor(ACTOR, skipAll(["RJ1", "BJ1", "BJ2"]));

    expect(result.works.map((work) => work.storeProductId)).toEqual(["RJ1", "BJ1", "BJ2"]);
    // 総件数はフロアの和
    expect(result.coverage).toEqual({ fetched: 3, total: 3, complete: true, pages: 2 });
    expect(fetchTextMock.mock.calls.map((call) => call[0])).toEqual([
      buildSearchUrl("上田麗奈", "release_d", "home"),
      buildSearchUrl("上田麗奈", "release_d", "garumani"),
    ]);
  });

  it("同じ作品 ID が両方のフロアに出ても 1 件になる", async () => {
    respondByFloor({
      home: { newest: ok(searchPage(["RJ1"], 1)) },
      garumani: { newest: ok(searchPage(["RJ1"], 1)) },
    });

    const result = await dlsiteAdapter.fetchByActor(ACTOR, skipAll(["RJ1"]));

    expect(result.works.map((work) => work.storeProductId)).toEqual(["RJ1"]);
    // 総件数はストアが各フロアで出した値の和なので、束ねた取得件数と一致しない。
    // それでもフロアはどちらも取り切れているので complete は立つ
    expect(result.coverage).toEqual({ fetched: 1, total: 2, complete: true, pages: 2 });
    expect(result.warnings).toEqual([]);
  });

  it("総件数ぶん取れていれば古い順の追加リクエストを出さない", async () => {
    respondByFloor({ home: { newest: ok(searchPage(["RJ1", "RJ2"], 2)) } });

    const result = await dlsiteAdapter.fetchByActor(ACTOR, skipAll(["RJ1", "RJ2"]));

    // フロアごとに 1 回ずつ。どちらも総件数に届いているので古い順は出ない
    expect(fetchTextMock).toHaveBeenCalledTimes(2);
    expect(result.coverage).toEqual({ fetched: 2, total: 2, complete: true, pages: 2 });
    expect(result.totalCount).toBe(2);
    expect(result.warnings).toEqual([]);
  });

  it("総件数に届かなければ古い順の 1 ページ目を足して和集合を取る", async () => {
    respondByFloor({
      home: {
        newest: ok(searchPage(["RJ1", "RJ2"], 3)),
        // 古い順は重複 (RJ2) を含む。ID で束ねるので 3 件になる
        oldest: ok(searchPage(["RJ3", "RJ2"], 3)),
      },
    });

    const result = await dlsiteAdapter.fetchByActor(ACTOR, skipAll(["RJ1", "RJ2", "RJ3"]));

    expect(fetchTextMock.mock.calls.map((call) => call[0])).toContain(
      buildSearchUrl("上田麗奈", "release", "home"),
    );
    expect(result.works.map((work) => work.storeProductId)).toEqual(["RJ1", "RJ2", "RJ3"]);
    expect(result.coverage).toEqual({ fetched: 3, total: 3, complete: true, pages: 3 });
    expect(result.warnings).toEqual([]);
  });

  it("2 通りの並び順でも足りなければ網羅率を警告に積む", async () => {
    respondByFloor({
      home: { newest: ok(searchPage(["RJ1"], 40)), oldest: ok(searchPage(["RJ2"], 40)) },
    });

    const result = await dlsiteAdapter.fetchByActor(ACTOR, skipAll(["RJ1", "RJ2"]));

    expect(result.coverage).toEqual({ fetched: 2, total: 40, complete: false, pages: 3 });
    expect(result.warnings).toContain("網羅率 2/40 (全フロアの合計)");
  });

  it("古い順の取得に失敗しても新しい順の結果で続行する", async () => {
    respondByFloor({
      home: {
        newest: ok(searchPage(["RJ1"], 40)),
        oldest: { ok: false, url: "https://www.dlsite.com/", reason: "HTTP 503" },
      },
    });

    const result = await dlsiteAdapter.fetchByActor(ACTOR, skipAll(["RJ1"]));

    expect(result.status).toBe("ok");
    expect(result.works).toHaveLength(1);
    expect(result.coverage).toEqual({ fetched: 1, total: 40, complete: false, pages: 2 });
    expect(result.warnings).toContain(
      "home: 古い順での補完に失敗 (HTTP 503)。新しい順の結果だけで続行",
    );
    expect(result.warnings).toContain("網羅率 1/40 (全フロアの合計)");
  });

  it("総件数を読めなければ complete を立てず、追加リクエストも出さない", async () => {
    respondByFloor({ home: { newest: ok(searchPage(["RJ1"])) } });

    const result = await dlsiteAdapter.fetchByActor(ACTOR, skipAll(["RJ1"]));

    expect(fetchTextMock).toHaveBeenCalledTimes(2);
    expect(result.coverage).toEqual({ fetched: 1, pages: 2 });
    expect(result.totalCount).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  /** 片方のフロアが落ちても、取れた側は使う。総件数は分からなくなる */
  it("片方のフロアだけ引けなければ、取れた側で続行して警告に残す", async () => {
    respondByFloor({
      home: { newest: ok(searchPage(["RJ1"], 1)) },
      garumani: { newest: { ok: false, url: "https://www.dlsite.com/", reason: "timeout" } },
    });

    const result = await dlsiteAdapter.fetchByActor(ACTOR, skipAll(["RJ1"]));

    expect(result.status).toBe("ok");
    expect(result.works).toHaveLength(1);
    // 総件数は分からないが、取り切れていないことは確か。
    // これで crawl_runs 上「総件数が読めなかった走行」と区別が付く。
    // 落ちたフロアへの往復も pages に数える (相手サイトへの往復を隠さない)
    expect(result.coverage).toEqual({ fetched: 1, complete: false, pages: 2 });
    expect(result.warnings).toContain("garumani の検索ページを取れなかった (timeout)");
  });

  it("どのフロアも引けなければ error で coverage は残さない", async () => {
    fetchTextMock.mockResolvedValue({
      ok: false,
      url: "https://www.dlsite.com/",
      reason: "timeout",
    });

    const result = await dlsiteAdapter.fetchByActor(ACTOR, skipAll([]));

    expect(result.status).toBe("error");
    expect(result.coverage).toBeUndefined();
    // 失敗の理由は crawl_runs の error に残る唯一の手がかりなので、フロアごとに残す
    expect(result.reason).toBe("検索ページの取得に失敗 (home: timeout / garumani: timeout)");
  });
});

describe("dlsiteAdapter.fetchByActor の年齢区分", () => {
  beforeEach(() => {
    fetchTextMock.mockReset();
  });

  /** `product.json` 1 件ぶんの最小限の応答 */
  function productJsonFor(workno: string, ageCategory: number): FetchResult {
    return ok(
      JSON.stringify([
        { workno, work_name: `作品 ${workno}`, age_category: ageCategory, site_id: "bldrama" },
      ]),
    );
  }

  /**
   * 許可していない年齢区分は `product.json` を見て初めて分かる。フロアを増やしても
   * この除外は一覧ではなく詳細の側で効き続ける (一覧はどのフロアでも general を入れる)
   */
  it("/garumani/ の作品でも age_category が全年齢でなければ保存しない", async () => {
    fetchTextMock.mockImplementation(async (url: string) => {
      if (url.includes("/garumani/fsr/")) return ok(searchPage(["BJ1", "BJ2"], 2));
      if (url.includes("/home/fsr/")) return ok(searchPage([], 0));
      if (url.includes("workno=BJ1")) return productJsonFor("BJ1", 1);
      if (url.includes("workno=BJ2")) return productJsonFor("BJ2", 3);
      throw new Error(`想定外の URL: ${url}`);
    });

    const result = await dlsiteAdapter.fetchByActor(ACTOR, { snapshot: false });

    expect(result.works.map((work) => work.storeProductId)).toEqual(["BJ1"]);
    expect(result.warnings).toContain("BJ2: 対象外の年齢区分 (age_category=3) のため除外");
  });
});
