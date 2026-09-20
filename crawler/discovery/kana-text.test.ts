import { describe, expect, it } from "vitest";
import { toStoredKana } from "./kana-text.ts";

describe("toStoredKana", () => {
  it("姓名の間の空白を落とす", () => {
    expect(toStoredKana("うえだ れいな")).toBe("うえだれいな");
  });

  it("中黒で区切られた読みも受け取る", () => {
    expect(toStoredKana("ブリドカット・セーラ・めぐみ")).toBe("ぶりどかっとせーらめぐみ");
  });

  it("カタカナはひらがなに寄せる (ひらがなで引いた検索に当てるため)", () => {
    expect(toStoredKana("みどう ダリア")).toBe("みどうだりあ");
    expect(toStoredKana("ソンド")).toBe("そんど");
  });

  it("長音符は残す", () => {
    expect(toStoredKana("ひろせ ゆうすけー")).toBe("ひろせゆうすけー");
  });

  it("内部リンクと脚注は落とす", () => {
    expect(toStoredKana("[[のがみ ゆかな|ゆかな]]")).toBe("ゆかな");
    expect(
      toStoredKana('あまの さとみ<ref name="x">{{Cite web|url=http://example.com}}</ref>'),
    ).toBe("あまのさとみ");
  });

  it("かな以外が残る値は読みとして扱わない", () => {
    expect(toStoredKana("上田 麗奈")).toBeUndefined();
    expect(toStoredKana("KENN")).toBeUndefined();
    expect(toStoredKana("")).toBeUndefined();
  });
});
