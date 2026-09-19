import { describe, expect, test } from "vitest";
import { actorDisplayName } from "./actor-name";

describe("actorDisplayName", () => {
  const withEn = { canonicalName: "上田麗奈", nameEn: "Reina Ueda" };
  const withoutEn = { canonicalName: "上田麗奈" };

  test("日本語表示では常に canonicalName", () => {
    expect(actorDisplayName(withEn, "ja")).toBe("上田麗奈");
    expect(actorDisplayName(withoutEn, "ja")).toBe("上田麗奈");
  });

  /** name_en は今は全件 NULL。入ったときに自動で効くことをここで固定する */
  test("英語表示では name_en があればそれを使う", () => {
    expect(actorDisplayName(withEn, "en")).toBe("Reina Ueda");
  });

  test("英語表示でも name_en が無ければ canonicalName に戻す", () => {
    expect(actorDisplayName(withoutEn, "en")).toBe("上田麗奈");
    expect(actorDisplayName({ canonicalName: "上田麗奈", nameEn: "" }, "en")).toBe("上田麗奈");
  });
});
