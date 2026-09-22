import { describe, expect, it } from "vitest";
import { findAnimeSlugCollisions, toAnimeRole, toAnimeSlug } from "./anime-entity.ts";

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

describe("findAnimeSlugCollisions", () => {
  it("同じ slug の作品が 2 件以上あれば返す", () => {
    const collisions = findAnimeSlugCollisions([
      { id: "anilist:1", slug: "same-title", titleRomaji: "Same Title" },
      { id: "anilist:2", slug: "same-title", titleRomaji: "Same Title" },
      { id: "anilist:3", slug: "other", titleRomaji: "Other" },
    ]);

    expect(collisions).toHaveLength(1);
    expect(collisions[0]?.members.map((member) => member.id)).toEqual(["anilist:1", "anilist:2"]);
  });

  it("衝突が無ければ空", () => {
    expect(findAnimeSlugCollisions([])).toEqual([]);
  });
});
