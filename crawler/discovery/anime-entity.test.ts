import { describe, expect, it } from "vitest";
import {
  type AnimeCreditInput,
  type AnimeMediaInput,
  buildAnimeEntities,
  findAnimeSlugCollisions,
  type TargetActorInput,
  toAnimeRole,
  toAnimeSlug,
} from "./anime-entity.ts";

function media(overrides: Partial<AnimeMediaInput> = {}): AnimeMediaInput {
  return {
    id: 195516,
    season: { year: 2026, season: "FALL" },
    titleNative: "薬屋のひとりごと 第3期",
    titleRomaji: "Kusuriya no Hitorigoto 3rd Season",
    titleEnglish: "The Apothecary Diaries Season 3",
    coverImageUrl: "https://s4.anilist.co/cover.jpg",
    ...overrides,
  };
}

function credit(overrides: Partial<AnimeCreditInput> = {}): AnimeCreditInput {
  return {
    mediaId: 195516,
    staffId: 95359,
    characterId: 12345,
    characterNameNative: "猫猫",
    characterNameFull: "Maomao",
    characterImageUrl: "https://s4.anilist.co/char.jpg",
    role: "MAIN",
    ...overrides,
  };
}

const TARGET: TargetActorInput[] = [{ id: "va_yuuki-aoi", anilistStaffId: 95359 }];

describe("toAnimeSlug", () => {
  it("ローマ字タイトルを小文字のハイフン区切りにする", () => {
    expect(toAnimeSlug("Sousou no Frieren")).toBe("sousou-no-frieren");
  });

  it("コロンや中黒も区切りとして扱い、連続と前後のハイフンを畳む", () => {
    // URL に記号が出るとエスケープの有無で同じページが二重に見える
    expect(toAnimeSlug("Made in Abyss: Mezameru Shinpi")).toBe("made-in-abyss-mezameru-shinpi");
    expect(toAnimeSlug("  Cyberpunk: Edgerunners 2  ")).toBe("cyberpunk-edgerunners-2");
  });

  it("ローマ字が無い、または記号だけなら undefined", () => {
    expect(toAnimeSlug(undefined)).toBeUndefined();
    expect(toAnimeSlug("！？")).toBeUndefined();
  });
});

describe("toAnimeRole", () => {
  it("MAIN と SUPPORTING だけを受け取る", () => {
    expect(toAnimeRole("MAIN")).toBe("main");
    expect(toAnimeRole("SUPPORTING")).toBe("supporting");
  });

  it("BACKGROUND と未指定は undefined (出演ごと捨てる)", () => {
    expect(toAnimeRole("BACKGROUND")).toBeUndefined();
    expect(toAnimeRole(undefined)).toBeUndefined();
  });
});

describe("buildAnimeEntities", () => {
  it("対象声優の出演だけをエンティティにする", () => {
    const result = buildAnimeEntities([media()], [credit()], TARGET);

    expect(result.anime).toHaveLength(1);
    const anime = result.anime[0];
    expect(anime?.id).toBe("anilist:195516");
    expect(anime?.slug).toBe("kusuriya-no-hitorigoto-3rd-season");
    expect(anime?.titleEnglish).toBe("The Apothecary Diaries Season 3");
    expect(anime?.seasonYear).toBe(2026);
    expect(anime?.appearances).toEqual([
      {
        voiceActorId: "va_yuuki-aoi",
        characterId: "anilist:12345",
        characterNameNative: "猫猫",
        characterNameFull: "Maomao",
        characterImageUrl: "https://s4.anilist.co/char.jpg",
        role: "main",
      },
    ]);
  });

  it("人気度・形式・放送日・別名・代表色をそのまま渡す", () => {
    const result = buildAnimeEntities(
      [
        media({
          popularity: 70218,
          format: "TV",
          startDate: "2026-10-02",
          endDate: "2026-12-25",
          synonyms: ["ロシデレ"],
          coverImageColor: "#e4a128",
        }),
      ],
      [credit()],
      TARGET,
    );

    expect(result.anime[0]).toMatchObject({
      popularity: 70218,
      format: "TV",
      startDate: "2026-10-02",
      endDate: "2026-12-25",
      synonyms: ["ロシデレ"],
      coverImageColor: "#e4a128",
    });
  });

  it("別名が 0 件なら項目自体を出さない", () => {
    const result = buildAnimeEntities([media({ synonyms: [] })], [credit()], TARGET);

    expect(result.anime[0]).not.toHaveProperty("synonyms");
  });

  it("対象外の声優は入れない (全キャストを保存しない)", () => {
    const result = buildAnimeEntities([media()], [credit({ staffId: 99999 })], TARGET);

    expect(result.anime).toEqual([]);
    expect(result.excluded).toEqual([
      {
        mediaId: 195516,
        titleNative: "薬屋のひとりごと 第3期",
        titleRomaji: "Kusuriya no Hitorigoto 3rd Season",
        reason: "no-appearance",
      },
    ]);
  });

  it("BACKGROUND しか無い作品は出演 0 件として除外する", () => {
    const result = buildAnimeEntities([media()], [credit({ role: "BACKGROUND" })], TARGET);

    expect(result.anime).toEqual([]);
    expect(result.excluded[0]?.reason).toBe("no-appearance");
  });

  it("ローマ字が無い作品は slug を作れないので除外する", () => {
    const input = media({ titleRomaji: undefined });
    const result = buildAnimeEntities([input], [credit()], TARGET);

    expect(result.anime).toEqual([]);
    expect(result.excluded[0]?.reason).toBe("no-slug");
  });

  it("同じ声優が同じ作品で複数キャラを演じたら両方入る", () => {
    const credits = [credit(), credit({ characterId: 22222, characterNameNative: "別のキャラ" })];
    const result = buildAnimeEntities([media()], credits, TARGET);

    expect(result.anime[0]?.appearances).toHaveLength(2);
  });

  it("同じ (作品, キャラ, 声優) が重複して入っていても 1 件に畳む", () => {
    const result = buildAnimeEntities([media()], [credit(), credit()], TARGET);

    expect(result.anime[0]?.appearances).toHaveLength(1);
  });

  it("英語タイトルが無くても生成できる", () => {
    const input = media({ titleEnglish: undefined });
    const result = buildAnimeEntities([input], [credit()], TARGET);

    expect(result.anime[0]?.titleEnglish).toBeUndefined();
    expect(result.anime[0]?.titleRomaji).toBe("Kusuriya no Hitorigoto 3rd Season");
  });
});

describe("findAnimeSlugCollisions", () => {
  it("同じ slug の作品が 2 件以上あれば返す", () => {
    const first = media({ id: 1 });
    const second = media({ id: 2, titleNative: "別作品" });
    const credits = [credit({ mediaId: 1 }), credit({ mediaId: 2 })];
    const result = buildAnimeEntities([first, second], credits, TARGET);

    expect(result.collisions).toHaveLength(1);
    expect(result.collisions[0]?.members.map((m) => m.id)).toEqual(["anilist:1", "anilist:2"]);
  });

  it("衝突が無ければ空", () => {
    expect(findAnimeSlugCollisions([])).toEqual([]);
  });
});
