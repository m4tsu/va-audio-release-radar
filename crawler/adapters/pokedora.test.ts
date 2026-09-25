import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RawWork } from "../../src/contract/index.ts";
import type { FetchResult } from "../lib/fetch.ts";
import { FIXTURES_DIR } from "../lib/paths.ts";
import {
  applyProductDetail,
  buildCoverImageUrl,
  buildFeedUrl,
  buildProductUrl,
  buildTagPageUrl,
  FEED_DISP_NUMBER,
  POKEDORA_SECTIONS,
  parseActiveSection,
  parseProductDetail,
  parseSearchHtml,
  parseTagTotalCount,
  pokedoraAdapter,
  sectionsToFetch,
} from "./pokedora.ts";

// fetchByActor の分岐 (ページ送り・詳細の飛ばし) だけをネットワーク無しで確かめるための差し替え。
// 解析そのものはフィクスチャ側のテストで見ている (素の fetch は呼ばない)
vi.mock("../lib/fetch.ts", () => ({ fetchText: vi.fn() }));
const { fetchText } = await import("../lib/fetch.ts");
const fetchTextMock = vi.mocked(fetchText);

/**
 * 実際に取得した HTML (crawler/fixtures/) に対する固定テスト。
 * ポケドラの HTML 構造が変わったらここが落ちる。ネットワークには出ない
 */

const FETCHED_AT = "2026-09-18T00:00:00.000Z";
const fixture = (name: string) => readFileSync(path.join(FIXTURES_DIR, name), "utf8");

/** 新着一覧 (order=1) の 1 ページ目。一般と BL で 15 件ずつ */
const feedHtml = {
  men: fixture("pokedora-list-order1-men-page1.html"),
  bl: fixture("pokedora-list-order1-bl-page1.html"),
};
/** 一般 (men) 10 件のタグページ */
const tagMenHtml = fixture("pokedora-tag-1920-men.html");
/** BL 66 件のタグページ。1 ページに 100 件まで出るので 1 枚に収まっている */
const tagBlHtml = fixture("pokedora-tag-1920-bl.html");
/** 声優 2 名・シリーズ欄なし・一般 */
const detail126232 = fixture("pokedora-detail-126232.html");
/** 声優 17 名・BL。タイトルの【出演声優：…】は 6 名しか出ない作品 */
const detail93854 = fixture("pokedora-detail-93854.html");
/** 期間限定無料の作品 */
const detail101656 = fixture("pokedora-detail-101656.html");
/** BL・特典あり。商品カテゴリが 2 つ付く */
const detail103703 = fixture("pokedora-detail-103703.html");
/** シチュエーションCD・声優 1 名 */
const detail139137 = fixture("pokedora-detail-139137.html");

describe("URL の組み立て", () => {
  it("タグページは disp_number を最大にし、ストア区分とページ番号を付ける", () => {
    expect(buildTagPageUrl(1920, "bl", 2)).toBe(
      "https://pokedora.com/tags/?tag_type=1&tag_id=1920&disp_number=100&store=bl&pageno=2",
    );
  });

  it("ページ番号を省略すると 1 ページ目になる", () => {
    expect(buildTagPageUrl(1920, "men")).toContain("&pageno=1");
  });

  it("商品 URL と表紙 URL は product_id から組み立てられる", () => {
    expect(buildProductUrl("126232")).toBe(
      "https://pokedora.com/products/detail.php?product_id=126232",
    );
    expect(buildCoverImageUrl("126232")).toBe(
      "https://pokedora.com/get_image.php?product_id=126232&thumb=large",
    );
  });
});

describe("parseTagTotalCount", () => {
  it("「…に関する作品(N件)」から総件数を取る", () => {
    expect(parseTagTotalCount(tagMenHtml)).toBe(10);
    expect(parseTagTotalCount(tagBlHtml)).toBe(66);
  });

  it("件数の表示が無ければ undefined (総件数を知らないまま完全とは記録しない)", () => {
    expect(parseTagTotalCount("<h2>人気検索ワード</h2>")).toBeUndefined();
  });
});

describe("parseActiveSection", () => {
  it("選択中のタブからストア区分を取る", () => {
    expect(parseActiveSection(tagMenHtml)).toBe("men");
    expect(parseActiveSection(tagBlHtml)).toBe("bl");
  });
});

describe("parseSearchHtml (タグページ)", () => {
  it("一覧の作品をすべて拾い、総件数と一致する", () => {
    const parsed = parseSearchHtml(tagMenHtml, FETCHED_AT);
    expect(parsed.works).toHaveLength(10);
    expect(parsed.totalCount).toBe(10);
    expect(parsed.invalidCount).toBe(0);
  });

  it("100 件表示の BL ページでも総件数ぶん取れている", () => {
    const parsed = parseSearchHtml(tagBlHtml, FETCHED_AT);
    expect(parsed.works).toHaveLength(66);
    expect(parsed.totalCount).toBe(66);
  });

  it("一覧だけで ID・タイトル・区分・表紙が揃う (既知の作品はこれで済ませる)", () => {
    const parsed = parseSearchHtml(tagMenHtml, FETCHED_AT);
    const work = parsed.works.find((item) => item.storeProductId === "139137");
    expect(work).toMatchObject({
      storeSlug: "pokedora",
      storeProductId: "139137",
      titleRaw:
        "《1トラック無料》23時のママたち～山小屋の管理人 紬季の場合～【出演声優：小林千晃】",
      productUrl: "https://pokedora.com/products/detail.php?product_id=139137",
      coverImageUrl: "https://pokedora.com/get_image.php?product_id=139137&thumb=large",
      storeCategory: "シチュエーションCD",
      storeSection: "men",
      ageRating: "general",
      fetchedAt: FETCHED_AT,
    });
    // 発売日はポケドラのどのページにも無い (初回発見日で新着判定する側に乗る)
    expect(work?.releaseDate).toBeUndefined();
    // 一覧には出演声優が出ない。詳細で埋める
    expect(work?.creditedNames).toEqual([]);
  });

  it("BL のページから取った作品は storeSection が bl になる", () => {
    const parsed = parseSearchHtml(tagBlHtml, FETCHED_AT);
    expect(parsed.works.every((work) => work.storeSection === "bl")).toBe(true);
    // BL は年齢区分ではなく内容の区分なので ageRating は general のまま
    expect(parsed.works.every((work) => work.ageRating === "general")).toBe(true);
  });

  it("同じ作品 ID が重複しない", () => {
    const parsed = parseSearchHtml(tagBlHtml, FETCHED_AT);
    const ids = parsed.works.map((work) => work.storeProductId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("parseProductDetail", () => {
  it("詳細ページの項目をひととおり取る", () => {
    expect(parseProductDetail(detail126232)).toEqual({
      title: "ボイスドラマ「おかえり、初恋。」通常版【出演声優：小林千晃 上田麗奈】",
      makerName: "シルフ",
      section: "men",
      storeCategory: "一般ドラマCD",
      coverImageUrl: "https://pokedora.com/get_image.php?product_id=126232&thumb=large",
      credits: [
        { name: "小林千晃", tagId: 1920 },
        { name: "上田麗奈", tagId: 1554 },
      ],
      genres: ["一般ドラマCD", "初恋", "黒髪", "不良/ヤンキー", "再会", "かめみずとら"],
    });
  });

  it("出演声優は作品情報欄から全員取る (タイトルに出るのは 6 名でも 17 名取れる)", () => {
    const detail = parseProductDetail(detail93854);
    expect(detail.credits).toHaveLength(17);
    expect(detail.credits.map((credit) => credit.name)).toEqual([
      "前野智昭",
      "高塚智人",
      "白井悠介",
      "三宅健太",
      "田丸篤志",
      "古川慎",
      "榊原優希",
      "市川蒼",
      "奥村翔",
      "安田陸矢",
      "浜田洋平",
      "小林千晃",
      "三好晃祐",
      "林大地",
      "永野由祐",
      "高坂知也",
      "帆世雄一",
    ]);
    // タイトル末尾の【出演声優：…】には 6 名しか出ていない。そちらを使うと 11 名取りこぼす
    expect(detail.title).toContain(
      "【出演声優：前野智昭 高塚智人 白井悠介 三宅健太 田丸篤志 古川慎】",
    );
  });

  it("出演声優の tag_id を取る (同じ tag_id なら同一人物というストア由来の事実)", () => {
    const detail = parseProductDetail(detail93854);
    expect(detail.credits.find((credit) => credit.name === "小林千晃")?.tagId).toBe(1920);
    expect(detail.credits.find((credit) => credit.name === "古川慎")?.tagId).toBe(1267);
  });

  it("BL の作品は section が bl になる", () => {
    expect(parseProductDetail(detail93854).section).toBe("bl");
    expect(parseProductDetail(detail103703).section).toBe("bl");
  });

  it("一般の作品は section が men になる (パンくずの store=home ではなく men に寄せる)", () => {
    expect(parseProductDetail(detail126232).section).toBe("men");
    expect(parseProductDetail(detail101656).section).toBe("men");
    expect(parseProductDetail(detail139137).section).toBe("men");
  });

  it("商品カテゴリが複数ある作品は先頭を storeCategory にし、全部を genres に入れる", () => {
    const detail = parseProductDetail(detail103703);
    expect(detail.storeCategory).toBe("BLCD");
    expect(detail.genres.slice(0, 2)).toEqual(["BLCD", "特典あり"]);
  });

  it("声優 1 名・シリーズありの作品も取れる", () => {
    const detail = parseProductDetail(detail139137);
    expect(detail.credits).toEqual([{ name: "小林千晃", tagId: 1920 }]);
    expect(detail.makerName).toBe("Protostar Sound");
  });

  it("欄そのものが無い HTML でも落ちない", () => {
    expect(parseProductDetail("<html><body></body></html>")).toEqual({ credits: [], genres: [] });
  });
});

describe("applyProductDetail", () => {
  const listWork = (): RawWork => {
    const parsed = parseSearchHtml(tagMenHtml, FETCHED_AT);
    const found = parsed.works.find((work) => work.storeProductId === "126232");
    if (found === undefined) throw new Error("フィクスチャに 126232 が無い");
    return found;
  };

  it("一覧の作品に詳細の出演声優とレーベルを足す", () => {
    const merged = applyProductDetail(listWork(), parseProductDetail(detail126232));
    expect(merged.creditedNames).toEqual(["小林千晃", "上田麗奈"]);
    expect(merged.makerName).toBe("シルフ");
    expect(merged.storeSection).toBe("men");
    // 発売日はどちらにも無いので、詳細を当てても付かない
    expect(merged.releaseDate).toBeUndefined();
  });

  it("詳細が空でも一覧の値を消さない", () => {
    const merged = applyProductDetail(listWork(), { credits: [], genres: [] });
    expect(merged.titleRaw).toBe(listWork().titleRaw);
    expect(merged.storeSection).toBe("men");
  });
});

describe("sectionsToFetch", () => {
  it("辞書が 0 件と言っている区分は引かない", () => {
    expect(sectionsToFetch({ externalId: "1920", counts: { men: 10, bl: 66 } })).toEqual([
      "men",
      "bl",
    ]);
    expect(sectionsToFetch({ externalId: "1468", counts: { men: 0, bl: 48 } })).toEqual(["bl"]);
    expect(sectionsToFetch({ externalId: "318", counts: { men: 68, bl: 1 } })).toEqual([
      "men",
      "bl",
    ]);
  });

  it("件数が分からなければ両方引く", () => {
    expect(sectionsToFetch({ externalId: "1920" })).toEqual(["men", "bl"]);
  });
});

describe("fetchByActor", () => {
  const ok = (body: string): FetchResult => ({ ok: true, status: 200, url: "https://x", body });

  beforeEach(() => {
    fetchTextMock.mockReset();
  });

  it("辞書に tag_id が無ければ 1 度も取得しない", async () => {
    const result = await pokedoraAdapter.fetchByActor({
      canonicalName: "誰か",
      searchNames: ["誰か"],
    });
    expect(result.status).toBe("empty");
    expect(fetchTextMock).not.toHaveBeenCalled();
  });

  it("件数のある区分だけを引き、既知の作品は詳細を取り直さない", async () => {
    // men の 10 件だけを対象にし、10 件中 9 件を既知にする → 詳細取得は 1 回だけ
    fetchTextMock.mockImplementation((url: string) => {
      if (url.includes("/tags/")) return Promise.resolve(ok(tagMenHtml));
      return Promise.resolve(ok(detail139137));
    });

    const listed = parseSearchHtml(tagMenHtml, FETCHED_AT).works.map((work) => work.storeProductId);
    const known = new Set(listed.filter((id) => id !== "139137"));

    const result = await pokedoraAdapter.fetchByActor(
      {
        canonicalName: "小林千晃",
        searchNames: ["小林千晃"],
        storeActorRefs: { pokedora: [{ externalId: "1920", counts: { men: 10, bl: 0 } }] },
      },
      { skipKnownIds: known, snapshot: false },
    );

    const urls = fetchTextMock.mock.calls.map((call) => String(call[0]));
    // bl は辞書が 0 件と言っているので引かない
    expect(urls.filter((url) => url.includes("store=bl"))).toHaveLength(0);
    expect(urls.filter((url) => url.includes("detail.php"))).toHaveLength(1);
    expect(result.status).toBe("ok");
    expect(result.works).toHaveLength(10);
    expect(result.coverage).toMatchObject({ fetched: 10, total: 10, complete: true, pages: 1 });
    // 詳細を引いた 1 件だけ tag_id が取れる
    expect(result.observedActorRefs).toEqual([{ externalId: "1920", name: "小林千晃" }]);
  });

  it("辞書が一般も BL も 0 件と言っていれば empty (取得しにいかないので失敗ではない)", async () => {
    const result = await pokedoraAdapter.fetchByActor({
      canonicalName: "誰か",
      searchNames: ["誰か"],
      storeActorRefs: { pokedora: [{ externalId: "1", counts: { men: 0, bl: 0 } }] },
    });
    expect(result.status).toBe("empty");
    expect(fetchTextMock).not.toHaveBeenCalled();
  });

  it("総件数に届かなければ次のページを引く", async () => {
    // 1 ページ目は総件数 66 に対し 10 件しか返さない (件数表示だけ 66 に差し替えた men ページ)。
    // 足りないので 2 ページ目を引き、そこで残りが返る、という形をなぞる
    const shortFirstPage = tagMenHtml.replace("に関する作品(10件)", "に関する作品(66件)");
    let tagCalls = 0;
    fetchTextMock.mockImplementation((url: string) => {
      if (!url.includes("/tags/")) return Promise.resolve(ok(detail126232));
      tagCalls += 1;
      return Promise.resolve(ok(tagCalls === 1 ? shortFirstPage : tagBlHtml));
    });

    // 詳細取得は 1 件も要らないので、両ページの作品をすべて既知にしておく
    const known = new Set(
      [
        ...parseSearchHtml(tagMenHtml, FETCHED_AT).works,
        ...parseSearchHtml(tagBlHtml, FETCHED_AT).works,
      ].map((work) => work.storeProductId),
    );

    const result = await pokedoraAdapter.fetchByActor(
      {
        canonicalName: "小林千晃",
        searchNames: ["小林千晃"],
        storeActorRefs: { pokedora: [{ externalId: "1920", counts: { men: 0, bl: 66 } }] },
      },
      { skipKnownIds: known, snapshot: false },
    );

    const pagenos = fetchTextMock.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.includes("/tags/"))
      .map((url) => /pageno=(\d+)/.exec(url)?.[1]);
    expect(pagenos).toEqual(["1", "2"]);
    expect(result.coverage?.pages).toBe(2);
  });

  it("タグページを 1 枚も取れなければ error にする (0 件と混ぜない)", async () => {
    fetchTextMock.mockResolvedValue({ ok: false, url: "https://x", reason: "timeout" });
    const result = await pokedoraAdapter.fetchByActor({
      canonicalName: "小林千晃",
      searchNames: ["小林千晃"],
      storeActorRefs: { pokedora: [{ externalId: "1920", counts: { men: 10, bl: 0 } }] },
    });
    expect(result.status).toBe("error");
    expect(result.works).toHaveLength(0);
  });

  it("詳細の取得に失敗しても一覧の情報だけで続ける", async () => {
    fetchTextMock.mockImplementation((url: string) => {
      if (url.includes("/tags/")) return Promise.resolve(ok(tagMenHtml));
      return Promise.resolve({ ok: false as const, url, reason: "HTTP 500" });
    });
    const result = await pokedoraAdapter.fetchByActor({
      canonicalName: "小林千晃",
      searchNames: ["小林千晃"],
      storeActorRefs: { pokedora: [{ externalId: "1920", counts: { men: 10, bl: 0 } }] },
    });
    expect(result.status).toBe("ok");
    expect(result.works).toHaveLength(10);
    expect(result.warnings.join("\n")).toContain("詳細ページの取得に失敗");
  });
});

describe("buildFeedUrl", () => {
  it("order=1 (新着順) の 1 ページ目を指す", () => {
    expect(buildFeedUrl("men")).toBe(
      "https://pokedora.com/products/list.php?mode=search&name=&xfp=0&genre_tag_id=0" +
        "&order=1&store=men&disp_number=30&pageno=1",
    );
    expect(buildFeedUrl("bl")).toContain("store=bl");
  });

  it("robots.txt が禁じている経路を指さない", () => {
    // 禁止は /cart/* と /mypage/* だけ (docs/stores/pokedora.md の「robots.txt」)
    for (const section of POKEDORA_SECTIONS) {
      expect(buildFeedUrl(section)).not.toContain("/cart/");
      expect(buildFeedUrl(section)).not.toContain("/mypage/");
    }
  });

  /**
   * `list.php` は `/tags/` と受け付ける値が違い、`100` を渡すと 15 件に落ちる
   * (`docs/research/pokedora-disp-number-2026-09-21.md`)。省いたときの既定が変わっても
   * 窓の広さが動かないよう、受け付ける値を明示する
   */
  it("受け付けられる disp_number を明示する", () => {
    expect(buildFeedUrl("men")).toContain(`disp_number=${FEED_DISP_NUMBER}`);
    expect(buildFeedUrl("men")).not.toContain("disp_number=100");
  });
});

describe("parseSearchHtml (新着一覧)", () => {
  // フィクスチャは disp_number=100 で取ったもので 15 件 (docs/stores/pokedora.md の「出典」)
  it("タグページと同じセレクタで読める", () => {
    for (const section of POKEDORA_SECTIONS) {
      const parsed = parseSearchHtml(feedHtml[section], FETCHED_AT);
      expect(parsed.works).toHaveLength(15);
      expect(parsed.invalidCount).toBe(0);
      expect(parsed.warnings).toEqual([]);
      expect(parsed.works.every((work) => work.storeSection === section)).toBe(true);
    }
  });

  /**
   * NEW / 割引 / 特典あり のバッジが商品カテゴリと同じ class で、しかもカテゴリより先に並ぶ。
   * 除かないと storeCategory が "NEW" になる (docs/stores/pokedora.md の「新着一覧」)
   */
  it("NEW などのバッジを商品カテゴリに混ぜない", () => {
    const parsed = parseSearchHtml(feedHtml.men, FETCHED_AT);
    expect(parsed.works[0]).toMatchObject({
      storeProductId: "151971",
      storeCategory: "女性向けドラマCD",
      genres: ["女性向けドラマCD"],
    });
    const badges = ["NEW", "割引", "特典あり"];
    for (const work of parsed.works) {
      expect(badges).not.toContain(work.storeCategory);
      for (const genre of work.genres ?? []) expect(badges).not.toContain(genre);
    }
  });

  // 新着一覧の総件数はストア全体の作品数で、新着数ではない
  it("総件数を載せない", () => {
    expect(parseSearchHtml(feedHtml.men, FETCHED_AT).totalCount).toBeUndefined();
  });
});

describe("pokedoraAdapter.fetchNewReleases", () => {
  const ok = (body: string): FetchResult => ({ ok: true, status: 200, url: "https://x", body });

  /** 新着一覧の最小限の HTML。区分タブと商品カードだけを持つ */
  function listPage(productIds: readonly string[], section: "men" | "bl" = "men"): string {
    const items = productIds
      .map(
        (id) =>
          `<li class="product_list_el">` +
          `<p class="product_title"><a href="/products/detail.php?product_id=${id}" title="作品 ${id}">作品 ${id}</a></p>` +
          `<span class="product_catgory_el product_catgory_el-new">NEW</span>` +
          `<span class="product_catgory_el">一般ドラマCD</span>` +
          "</li>",
      )
      .join("");
    return (
      "<html><body>" +
      `<ul class="category_tab"><li><a class="category_tab_el_link active" data-store="${section}">x</a></li></ul>` +
      `<ul>${items}</ul></body></html>`
    );
  }

  beforeEach(() => {
    fetchTextMock.mockReset();
  });

  /** 一覧は区分ごとに、詳細は product_id ごとに返す */
  function respond(lists: Partial<Record<"men" | "bl", FetchResult>>, detail?: FetchResult) {
    fetchTextMock.mockImplementation(async (url: string) => {
      if (url.includes("list.php")) {
        const section = url.includes("store=bl") ? "bl" : "men";
        return lists[section] ?? ok(listPage([], section));
      }
      return detail ?? ok(detail126232);
    });
  }

  it("一般と BL の新着を 1 つにまとめる", async () => {
    respond({ men: ok(listPage(["1", "2"])), bl: ok(listPage(["3"], "bl")) });

    const result = await pokedoraAdapter.fetchNewReleases?.({ snapshot: false });

    expect(result?.status).toBe("ok");
    expect(result?.works.map((work) => work.storeProductId)).toEqual(["1", "2", "3"]);
    expect(result?.listedCount).toBe(3);
    expect(result?.pages).toBe(2);
    expect(result?.complete).toBe(true);
  });

  // 同じ商品が一般と BL の両方に出たときに二重にしない
  it("区分をまたいで同じ作品 ID が出ても 1 件にする", async () => {
    respond({ men: ok(listPage(["1"])), bl: ok(listPage(["1"], "bl")) });

    const result = await pokedoraAdapter.fetchNewReleases?.({ snapshot: false });

    expect(result?.works.map((work) => work.storeProductId)).toEqual(["1"]);
    expect(result?.listedCount).toBe(1);
    expect(result?.pages).toBe(2);
    // 詳細も 1 回しか引かない
    const detailUrls: string[] = fetchTextMock.mock.calls
      .map((call) => call[0])
      .filter((url: string) => url.includes("detail.php"));
    expect(detailUrls).toEqual([buildProductUrl("1")]);
  });

  it("区分ごとに 1 ページだけ引く", async () => {
    respond({ men: ok(listPage(["1"])) });

    await pokedoraAdapter.fetchNewReleases?.({ snapshot: false });

    const listUrls = fetchTextMock.mock.calls
      .map((call) => call[0])
      .filter((url: string) => url.includes("list.php"));
    expect(listUrls).toEqual([buildFeedUrl("men"), buildFeedUrl("bl")]);
  });

  it("既知の作品は詳細を取らず、送りもしない", async () => {
    respond({ men: ok(listPage(["1", "2"])) });

    const result = await pokedoraAdapter.fetchNewReleases?.({
      knownIds: new Set(["1"]),
      snapshot: false,
    });

    expect(result?.works.map((work) => work.storeProductId)).toEqual(["2"]);
    expect(result?.listedCount).toBe(2);
    const urls: string[] = fetchTextMock.mock.calls.map((call) => call[0]);
    const detailUrls = urls.filter((url) => url.includes("detail.php"));
    expect(detailUrls).toEqual([buildProductUrl("2")]);
  });

  it("新着が全部既知なら empty で返す", async () => {
    respond({ men: ok(listPage(["1"])) });

    const result = await pokedoraAdapter.fetchNewReleases?.({
      knownIds: new Set(["1"]),
      snapshot: false,
    });

    expect(result?.status).toBe("empty");
    expect(result?.works).toEqual([]);
  });

  it("片方の区分が落ちても、取れた側で続行して警告に残す", async () => {
    respond({
      men: ok(listPage(["1"])),
      bl: { ok: false, url: "https://pokedora.com/", reason: "timeout" },
    });

    const result = await pokedoraAdapter.fetchNewReleases?.({ snapshot: false });

    expect(result?.status).toBe("ok");
    expect(result?.works).toHaveLength(1);
    expect(result?.pages).toBe(1);
    // daily.ts はこの値だけを見て coverageComplete: false を送る
    expect(result?.complete).toBe(false);
    expect(result?.warnings).toContain("bl の新着一覧を取れなかった (timeout)");
  });

  // 新着一覧は常に埋まって返るので、0 件はセレクタが壊れた合図
  it("一覧は取れたのに作品が 0 件なら error にする", async () => {
    respond({ men: ok(listPage([])), bl: ok(listPage([])) });

    const result = await pokedoraAdapter.fetchNewReleases?.({ snapshot: false });

    expect(result?.status).toBe("error");
    expect(result?.reason).toBe("新着一覧から作品を 1 件も読めなかった");
  });

  it("どの区分も引けなければ error で、理由を区分ごとに残す", async () => {
    fetchTextMock.mockResolvedValue({
      ok: false,
      url: "https://pokedora.com/",
      reason: "timeout",
    });

    const result = await pokedoraAdapter.fetchNewReleases?.({ snapshot: false });

    expect(result?.status).toBe("error");
    expect(result?.complete).toBe(false);
    expect(result?.reason).toBe("新着一覧の取得に失敗 (men: timeout / bl: timeout)");
  });
});
