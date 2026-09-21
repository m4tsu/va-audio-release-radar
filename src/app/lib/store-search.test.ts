import { describe, expect, test } from "vitest";
import { storeActorSearchUrl } from "./store-search";

describe("storeActorSearchUrl", () => {
  test("DLsite は作者名の完全一致で音声作品に絞る", () => {
    const url = storeActorSearchUrl("dlsite", "上田麗奈");

    expect(url).toBe(
      "https://www.dlsite.com/home/fsr/=/language/jp/keyword_creater/" +
        "%22%E4%B8%8A%E7%94%B0%E9%BA%97%E5%A5%88%22/work_type_category[0]/audio",
    );
  });

  test("Audible はナレーター検索", () => {
    expect(storeActorSearchUrl("audible", "上田麗奈")).toBe(
      "https://www.audible.co.jp/search?searchNarrator=%E4%B8%8A%E7%94%B0%E9%BA%97%E5%A5%88",
    );
  });

  /** 名前は外から来る文字列。そのまま繋ぐと空白や & で URL が壊れる */
  test("名前の空白と記号は URL に入れる前に符号化する", () => {
    expect(storeActorSearchUrl("audible", "上田 麗奈&")).toBe(
      "https://www.audible.co.jp/search?searchNarrator=%E4%B8%8A%E7%94%B0%20%E9%BA%97%E5%A5%88%26",
    );
  });

  /** 名前から声優ページを開く手段がストアに無いので、押せるものを出さない */
  test("ポケドラは URL を返さない", () => {
    expect(storeActorSearchUrl("pokedora", "上田麗奈")).toBeUndefined();
  });
});
