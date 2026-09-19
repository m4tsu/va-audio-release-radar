import { describe, expect, test } from "vitest";
import { animeAlternateTitle, animeDisplayTitle } from "./anime-title";

describe("animeDisplayTitle", () => {
  const withEnglish = {
    titleNative: "薬屋のひとりごと",
    titleRomaji: "Kusuriya no Hitorigoto",
    titleEnglish: "The Apothecary Diaries",
  };
  const withoutEnglish = {
    titleNative: "薬屋のひとりごと",
    titleRomaji: "Kusuriya no Hitorigoto",
  };

  test("日本語表示では常に titleNative", () => {
    expect(animeDisplayTitle(withEnglish, "ja")).toBe("薬屋のひとりごと");
    expect(animeDisplayTitle(withoutEnglish, "ja")).toBe("薬屋のひとりごと");
  });

  test("英語表示では title_english があればそれを使う", () => {
    expect(animeDisplayTitle(withEnglish, "en")).toBe("The Apothecary Diaries");
  });

  test("英語表示で title_english が無ければローマ字名に落とす (日本語名には戻さない)", () => {
    expect(animeDisplayTitle(withoutEnglish, "en")).toBe("Kusuriya no Hitorigoto");
    expect(animeDisplayTitle({ ...withoutEnglish, titleEnglish: "" }, "en")).toBe(
      "Kusuriya no Hitorigoto",
    );
  });
});

describe("animeAlternateTitle", () => {
  const anime = {
    titleNative: "薬屋のひとりごと",
    titleRomaji: "Kusuriya no Hitorigoto",
    titleEnglish: "The Apothecary Diaries",
  };

  test("日本語表示では英語名、英語表示では日本語名", () => {
    expect(animeAlternateTitle(anime, "ja")).toBe("The Apothecary Diaries");
    expect(animeAlternateTitle(anime, "en")).toBe("薬屋のひとりごと");
  });

  test("英語名が無い作品の日本語表示ではローマ字名", () => {
    const withoutEnglish = { titleNative: anime.titleNative, titleRomaji: anime.titleRomaji };
    expect(animeAlternateTitle(withoutEnglish, "ja")).toBe("Kusuriya no Hitorigoto");
  });

  test("見出しと副題が同じ名前にならない", () => {
    for (const locale of ["ja", "en"] as const) {
      expect(animeAlternateTitle(anime, locale)).not.toBe(animeDisplayTitle(anime, locale));
    }
  });
});
