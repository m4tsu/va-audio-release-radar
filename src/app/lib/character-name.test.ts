import { describe, expect, test } from "vitest";
import { characterDisplayName } from "./character-name";

describe("characterDisplayName", () => {
  const withFull = { characterNameNative: "猫猫", characterNameFull: "Maomao" };
  const withoutFull = { characterNameNative: "猫猫" };

  test("日本語表示では常に characterNameNative", () => {
    expect(characterDisplayName(withFull, "ja")).toBe("猫猫");
    expect(characterDisplayName(withoutFull, "ja")).toBe("猫猫");
  });

  test("英語表示では character_name_full があればそれを使う", () => {
    expect(characterDisplayName(withFull, "en")).toBe("Maomao");
  });

  test("英語表示でも character_name_full が無ければ日本語の役名のまま", () => {
    expect(characterDisplayName(withoutFull, "en")).toBe("猫猫");
    expect(characterDisplayName({ characterNameNative: "猫猫", characterNameFull: "" }, "en")).toBe(
      "猫猫",
    );
  });

  test("日本語表記が空の役は、日本語表示でも英語表記で埋める", () => {
    const withoutNative = { characterNameNative: "", characterNameFull: "Maomao" };
    expect(characterDisplayName(withoutNative, "ja")).toBe("Maomao");
    expect(characterDisplayName(withoutNative, "en")).toBe("Maomao");
  });

  test("どちらの表記も無ければ空のまま (出す名前が無い)", () => {
    expect(characterDisplayName({ characterNameNative: "" }, "ja")).toBe("");
    expect(characterDisplayName({ characterNameNative: "" }, "en")).toBe("");
  });
});
