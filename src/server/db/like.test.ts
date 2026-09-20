import { describe, expect, it } from "vitest";
import { stripLikeWildcards } from "./like";

describe("stripLikeWildcards", () => {
  it("ワイルドカードだけの検索語は空になる", () => {
    expect(stripLikeWildcards("%")).toBe("");
    expect(stripLikeWildcards("_%_")).toBe("");
  });

  it("語に混ざったワイルドカードだけを落とす", () => {
    expect(stripLikeWildcards("上田%麗奈")).toBe("上田麗奈");
  });

  it("ワイルドカードが無ければそのまま返す", () => {
    expect(stripLikeWildcards("薬屋のひとりごと")).toBe("薬屋のひとりごと");
  });
});
