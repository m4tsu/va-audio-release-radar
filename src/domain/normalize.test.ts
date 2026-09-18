import { describe, expect, test } from "vitest";
import { normalizeName } from "./normalize.ts";

describe("normalizeName", () => {
  test("半角スペースと全角スペースの有無を吸収する", () => {
    expect(normalizeName("上田 麗奈")).toBe(normalizeName("上田麗奈"));
    expect(normalizeName("上田　麗奈")).toBe(normalizeName("上田麗奈"));
  });

  test("中黒 (・) を除去する", () => {
    expect(normalizeName("上田・麗奈")).toBe(normalizeName("上田麗奈"));
  });

  test("括弧・読点・句点・スラッシュ・ダッシュ類・記号を除去する", () => {
    expect(normalizeName("「上田麗奈」")).toBe(normalizeName("上田麗奈"));
    expect(normalizeName("【上田麗奈】")).toBe(normalizeName("上田麗奈"));
    expect(normalizeName("上田(麗奈)")).toBe(normalizeName("上田麗奈"));
    expect(normalizeName("上田（麗奈）")).toBe(normalizeName("上田麗奈"));
    expect(normalizeName("上田、麗奈")).toBe(normalizeName("上田麗奈"));
    expect(normalizeName("上田。麗奈")).toBe(normalizeName("上田麗奈"));
    expect(normalizeName("上田,麗奈")).toBe(normalizeName("上田麗奈"));
    expect(normalizeName("上田.麗奈")).toBe(normalizeName("上田麗奈"));
    expect(normalizeName("上田/麗奈")).toBe(normalizeName("上田麗奈"));
    expect(normalizeName("上田／麗奈")).toBe(normalizeName("上田麗奈"));
    expect(normalizeName("上田-麗奈")).toBe(normalizeName("上田麗奈"));
    expect(normalizeName("上田‐麗奈")).toBe(normalizeName("上田麗奈"));
    expect(normalizeName("上田ー麗奈")).toBe(normalizeName("上田麗奈"));
    expect(normalizeName("上田麗奈?")).toBe(normalizeName("上田麗奈"));
    expect(normalizeName("上田麗奈？")).toBe(normalizeName("上田麗奈"));
    expect(normalizeName("上田麗奈!")).toBe(normalizeName("上田麗奈"));
    expect(normalizeName("上田麗奈！")).toBe(normalizeName("上田麗奈"));
  });

  test("全角英数を半角化し、英字は小文字化する (NFKC)", () => {
    expect(normalizeName("ＡＢＣ")).toBe("abc");
    expect(normalizeName("ABC")).toBe("abc");
  });

  test("前置語 (例: CV.) は除去しない。別人格として扱う", () => {
    expect(normalizeName("CV.上田麗奈")).not.toBe(normalizeName("上田麗奈"));
  });

  test("かな⇄カナの変換はしない", () => {
    expect(normalizeName("うえだれいな")).not.toBe(normalizeName("ウエダレイナ"));
  });

  test("空文字は空文字のまま", () => {
    expect(normalizeName("")).toBe("");
  });

  test("記号だけの文字列は空文字になる", () => {
    expect(normalizeName("・ 　()")).toBe("");
  });
});
