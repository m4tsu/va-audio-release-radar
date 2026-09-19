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

/**
 * ポケドラは商品カテゴリだけで決める (T23)。実データ 492 件に出た 6 種類をすべて押さえる。
 * 内訳は BLCD 351 / 一般ドラマCD 76 / シチュエーションCD 35 / 音楽 17 /
 * 女性向けドラマCD 11 / 配信限定シチュエーション 2
 */
describe("categorize (ポケドラ)", () => {
  test("ドラマ CD 系のカテゴリは audio_drama", () => {
    expect(categorize("pokedora", "BLCD")).toBe("audio_drama");
    expect(categorize("pokedora", "一般ドラマCD")).toBe("audio_drama");
    expect(categorize("pokedora", "女性向けドラマCD")).toBe("audio_drama");
  });

  test("シチュエーション系のカテゴリは situation_voice", () => {
    expect(categorize("pokedora", "シチュエーションCD")).toBe("situation_voice");
    expect(categorize("pokedora", "配信限定シチュエーション")).toBe("situation_voice");
  });

  test("音楽はキャラクターソング CD なので other", () => {
    // 「【DIG-ROCK】RESISTANCE【Vo.AKANE（CV.古川慎）】」のような歌もの
    expect(categorize("pokedora", "音楽")).toBe("other");
  });

  test("カテゴリが取れなければ audio_drama (ドラマ CD のストアなので)", () => {
    expect(categorize("pokedora")).toBe("audio_drama");
    expect(categorize("pokedora", "見たことのない区分")).toBe("audio_drama");
  });

  test("関連ワードとタイトルは見ない", () => {
    // ASMR の語を含む 3 件は実データでもシチュエーション系のカテゴリに置かれていた
    expect(categorize("pokedora", "シチュエーションCD", ["ASMR", "添い寝"], "ASMR 添い寝")).toBe(
      "situation_voice",
    );
    // 内容の語 (「あまあま」「学園」) で区分が動かないこと
    expect(categorize("pokedora", "BLCD", ["あまあま", "学園"], "ボイスドラマ風のタイトル")).toBe(
      "audio_drama",
    );
  });
});
