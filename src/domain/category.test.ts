import { describe, expect, test } from "vitest";
import { categorize } from "./category.ts";

describe("categorize", () => {
  test("Audible はジャンルに関わらず audiobook", () => {
    expect(categorize("audible")).toBe("audiobook");
    expect(categorize("audible", "audiobook", ["朗読"])).toBe("audiobook");
  });

  test("DLsite の SOU は判定材料が無ければ asmr (全年齢音声の大半が ASMR のため)", () => {
    expect(categorize("dlsite", "SOU")).toBe("asmr");
    expect(categorize("dlsite", "SOU", [])).toBe("asmr");
    expect(categorize("dlsite", "SOU", ["歴史/時代物"], "幕末動乱美少女伝")).toBe("asmr");
  });

  test("ASMR 系のジャンルは asmr", () => {
    expect(categorize("dlsite", "SOU", ["ASMR", "癒し"])).toBe("asmr");
    expect(categorize("dlsite", "SOU", ["耳かき", "バイノーラル/ダミヘ"])).toBe("asmr");
    expect(categorize("dlsite", "SOU", ["ささやき"])).toBe("asmr");
    expect(categorize("dlsite", "SOU", ["睡眠導入"])).toBe("asmr");
  });

  test("ジャンルが無くてもタイトルの ASMR 系の語を拾う", () => {
    // DLsite のセット商品はジャンルが空のことがあり、材料がタイトルしか無い
    expect(categorize("dlsite", "SOU", [], "【新婚生活ASMR】いっしょにおやすみ")).toBe("asmr");
  });

  test("ジャンルに「ドラマ」があれば audio_drama", () => {
    expect(categorize("dlsite", "SOU", ["ボイスドラマ"])).toBe("audio_drama");
    expect(categorize("dlsite", "SOU", ["ドラマ"])).toBe("audio_drama");
  });

  /**
   * DLsite のジャンルにはドラマを表す語が無い (スナップショット 200 件で 0 件) ので、
   * ドラマ作品はタイトルでしか見分けられない
   */
  test("タイトルの「ボイスドラマ」「ドラマCD」は audio_drama", () => {
    expect(categorize("dlsite", "SOU", ["恋人同士", "百合"], "百合ボイスドラマ『半同棲!』")).toBe(
      "audio_drama",
    );
    expect(categorize("dlsite", "SOU", ["ファンタジー"], "ドラマCD 冥王異伝")).toBe("audio_drama");
  });

  test("ASMR ジャンルが付いていてもタイトルがボイスドラマなら audio_drama", () => {
    expect(categorize("dlsite", "SOU", ["ASMR", "百合"], "百合ボイスドラマ『第二章』")).toBe(
      "audio_drama",
    );
  });

  test("タイトルに「ドラマ」だけが入る ASMR 作品は asmr のまま", () => {
    // 「ASMRおやすみドラマ」のような煽り文句でドラマ扱いにしない
    expect(
      categorize("dlsite", "SOU", ["ASMR", "添い寝"], "【ASMRおやすみドラマ】いっぱい甘えてね"),
    ).toBe("asmr");
  });

  test("ASMR 系が無くシチュエーション系だけなら situation_voice", () => {
    expect(categorize("dlsite", "SOU", ["シチュエーションボイス"])).toBe("situation_voice");
    expect(categorize("dlsite", "SOU", [], "シチュエーションボイス集")).toBe("situation_voice");
  });

  test("ドラマとシチュエーションの両方があればドラマを優先する", () => {
    expect(categorize("dlsite", "SOU", ["シチュエーション", "ボイスドラマ"])).toBe("audio_drama");
  });

  test("DLsite でも SOU 以外 (例: MUS) は other", () => {
    expect(categorize("dlsite", "MUS", ["ボイスドラマ"])).toBe("other");
  });

  test("storeCategory が無い DLsite 作品は other", () => {
    expect(categorize("dlsite")).toBe("other");
  });
});
