import { describe, expect, it } from "vitest";
import { spacedNameCandidates } from "./spaced-name.ts";

describe("spacedNameCandidates", () => {
  it("4 文字以上は姓を 2 文字で切った形と 3 文字で切った形を返す", () => {
    expect(spacedNameCandidates("上田麗奈")).toEqual(["上田 麗奈", "上田麗 奈"]);
  });

  it("3 文字は 1 文字切りと 2 文字切りを返す (姓が 1 文字か 2 文字かは名前からは分からない)", () => {
    expect(spacedNameCandidates("梶裕貴")).toEqual(["梶 裕貴", "梶裕 貴"]);
  });

  it("2 文字は 1 文字切りしか作れない (林勇・魚建のような名義)", () => {
    expect(spacedNameCandidates("林勇")).toEqual(["林 勇"]);
    expect(spacedNameCandidates("魚建")).toEqual(["魚 建"]);
  });

  it("1 文字以下は切る位置が無いので候補を作らない", () => {
    expect(spacedNameCandidates("麦")).toEqual([]);
  });

  it("候補は常に 2 個以下", () => {
    expect(spacedNameCandidates("五十嵐大地郎").length).toBeLessThanOrEqual(2);
  });

  it("異体字も 1 文字として数える", () => {
    expect(spacedNameCandidates("種﨑敦美")).toEqual(["種﨑 敦美", "種﨑敦 美"]);
  });
});
