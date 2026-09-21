import { describe, expect, it } from "vitest";
import { digestMessage } from "./message";

const UEDA = { canonicalName: "上田麗奈", nameEn: "Reina Ueda" };
const HANAZAWA = { canonicalName: "花澤香菜", nameEn: "Kana Hanazawa" };
const NO_EN = { canonicalName: "架空ベータ" };

describe("digestMessage", () => {
  it("日本語は件数の題名と、声優名を並べた本文で、フォロー一覧を開く", () => {
    expect(digestMessage("ja", 2, [UEDA, HANAZAWA])).toEqual({
      title: "新作の音声作品 2 件",
      body: "上田麗奈、花澤香菜の新作が出ました",
      url: "/following",
    });
  });

  it("英語はローマ字表記で並べ、無い声優は漢字表記のまま", () => {
    const message = digestMessage("en", 3, [UEDA, NO_EN]);
    expect(message.title).toBe("3 new audio works");
    expect(message.body).toBe("New from Reina Ueda and 架空ベータ");
  });

  it("英語の 1 件は単数形", () => {
    expect(digestMessage("en", 1, [UEDA]).title).toBe("1 new audio work");
    expect(digestMessage("en", 1, [UEDA]).body).toBe("New from Reina Ueda");
  });

  /** 通知は 1 行ほどしか見えない。名前は 3 人までにして残りは人数で畳む */
  it("4 人以上は 3 人まで名前を出し、残りは人数で畳む", () => {
    const actors = [
      UEDA,
      HANAZAWA,
      NO_EN,
      { canonicalName: "4 人目" },
      { canonicalName: "5 人目" },
    ];
    expect(digestMessage("ja", 5, actors).body).toBe(
      "上田麗奈、花澤香菜、架空ベータ ほか 2 人の新作が出ました",
    );
    expect(digestMessage("en", 5, actors).body).toBe(
      "New from Reina Ueda, Kana Hanazawa, 架空ベータ and 2 more",
    );
  });

  it("ストアの URL は入れない", () => {
    const message = digestMessage("ja", 1, [UEDA]);
    expect(JSON.stringify(message)).not.toMatch(/dlsite|audible|pokedora|https?:/);
  });
});
