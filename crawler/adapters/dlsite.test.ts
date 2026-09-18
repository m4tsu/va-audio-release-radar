import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES_DIR } from "../lib/paths.ts";
import {
  applyProductDetail,
  buildProductJsonUrl,
  buildSearchUrl,
  parseProductJson,
  parseSearchHtml,
} from "./dlsite.ts";

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
