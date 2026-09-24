import { describe, expect, test } from "vitest";
import { actorDisplayName, creditDisplayName } from "./actor-name";

describe("actorDisplayName", () => {
  const withEn = { canonicalName: "上田麗奈", nameEn: "Reina Ueda" };
  const withoutEn = { canonicalName: "上田麗奈" };

  test("日本語表示では常に canonicalName", () => {
    expect(actorDisplayName(withEn, "ja")).toBe("上田麗奈");
    expect(actorDisplayName(withoutEn, "ja")).toBe("上田麗奈");
  });

  test("英語表示では name_en があればそれを使う", () => {
    expect(actorDisplayName(withEn, "en")).toBe("Reina Ueda");
  });

  test("英語表示でも name_en が無ければ canonicalName に戻す", () => {
    expect(actorDisplayName(withoutEn, "en")).toBe("上田麗奈");
    expect(actorDisplayName({ canonicalName: "上田麗奈", nameEn: "" }, "en")).toBe("上田麗奈");
  });
});

describe("creditDisplayName", () => {
  const resolved = {
    creditedName: "上田 麗奈",
    voiceActorName: "上田麗奈",
    voiceActorNameEn: "Reina Ueda",
  };

  test("名寄せ済みなら声優の表示名を言語に合わせて出す", () => {
    expect(creditDisplayName(resolved, "ja")).toBe("上田麗奈");
    expect(creditDisplayName(resolved, "en")).toBe("Reina Ueda");
  });

  test("未解決ならどの言語でもストア上の表記のまま出す", () => {
    expect(creditDisplayName({ creditedName: "知らない人" }, "ja")).toBe("知らない人");
    expect(creditDisplayName({ creditedName: "知らない人" }, "en")).toBe("知らない人");
  });
});
