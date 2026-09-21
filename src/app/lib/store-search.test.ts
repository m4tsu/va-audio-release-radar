import { describe, expect, test } from "vitest";
import { type SearchableActor, storeActorSearchUrl } from "./store-search";

function actor(over: Partial<SearchableActor> = {}): SearchableActor {
  return { canonicalName: "上田麗奈", aliases: [], ...over };
}

describe("storeActorSearchUrl", () => {
  test("DLsite は作者名の完全一致で音声作品に絞る", () => {
    expect(storeActorSearchUrl("dlsite", actor())).toBe(
      "https://www.dlsite.com/home/fsr/=/language/jp/keyword_creater/" +
        "%22%E4%B8%8A%E7%94%B0%E9%BA%97%E5%A5%88%22/work_type_category[0]/audio",
    );
  });

  /** DLsite の検索は表記揺れの影響を受けないので、別名があっても正規表記で引く */
  test("DLsite は別名があっても正規表記で引く", () => {
    expect(
      storeActorSearchUrl("dlsite", actor({ aliases: [{ name: "上田 麗奈", verified: true }] })),
    ).toBe(storeActorSearchUrl("dlsite", actor()));
  });

  test("Audible はナレーター検索", () => {
    expect(storeActorSearchUrl("audible", actor())).toBe(
      "https://www.audible.co.jp/search?searchNarrator=%E4%B8%8A%E7%94%B0%E9%BA%97%E5%A5%88",
    );
  });

  /** 詰めた表記では 0 件になる声優がいる。クローラーが先に試す表記に合わせる */
  test("Audible は検証済みの空白入り別名があればそちらで引く", () => {
    expect(
      storeActorSearchUrl("audible", actor({ aliases: [{ name: "上田 麗奈", verified: true }] })),
    ).toBe(
      "https://www.audible.co.jp/search?searchNarrator=%E4%B8%8A%E7%94%B0%20%E9%BA%97%E5%A5%88",
    );
  });

  /** 未検証の別名は姓の切り方を当てずっぽうで持っている。人に見せる URL では使わない */
  test("Audible は未検証の別名を使わない", () => {
    expect(
      storeActorSearchUrl("audible", actor({ aliases: [{ name: "上田 麗奈", verified: false }] })),
    ).toBe("https://www.audible.co.jp/search?searchNarrator=%E4%B8%8A%E7%94%B0%E9%BA%97%E5%A5%88");
  });

  /** 名前は外から来る文字列。そのまま繋ぐと空白や & で URL が壊れる */
  test("名前の記号は URL に入れる前に符号化する", () => {
    expect(storeActorSearchUrl("audible", actor({ canonicalName: "上田麗奈&" }))).toBe(
      "https://www.audible.co.jp/search?searchNarrator=%E4%B8%8A%E7%94%B0%E9%BA%97%E5%A5%88%26",
    );
  });

  /** 名前から声優ページを開く手段がストアに無いので、押せるものを出さない */
  test("ポケドラは URL を返さない", () => {
    expect(storeActorSearchUrl("pokedora", actor())).toBeUndefined();
  });
});
