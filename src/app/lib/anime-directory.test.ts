import { describe, expect, it } from "vitest";
import { DEFAULT_ANIME_SORT, isAnimeSort, sortSeasonAnime } from "./anime-directory";

const ANIME = [
  { slug: "popular", actorCount: 2 },
  { slug: "middle", actorCount: 9 },
  { slug: "unpopular", actorCount: 5 },
];

const slugs = (items: Array<{ slug: string }>) => items.map((item) => item.slug);

describe("sortSeasonAnime", () => {
  it("既定はサーバーが返した順 (人気順) のまま", () => {
    expect(slugs(sortSeasonAnime(ANIME, DEFAULT_ANIME_SORT))).toEqual([
      "popular",
      "middle",
      "unpopular",
    ]);
  });

  it("出演者の人数順に並べ替える", () => {
    expect(slugs(sortSeasonAnime(ANIME, "actorCount"))).toEqual(["middle", "unpopular", "popular"]);
  });

  it("同数なら受け取った順 (人気順) を保つ", () => {
    const tied = [
      { slug: "a", actorCount: 3 },
      { slug: "b", actorCount: 3 },
    ];
    expect(slugs(sortSeasonAnime(tied, "actorCount"))).toEqual(["a", "b"]);
  });

  it("元の配列を書き換えない", () => {
    const original = [...ANIME];
    sortSeasonAnime(ANIME, "actorCount");
    expect(ANIME).toEqual(original);
  });
});

describe("isAnimeSort", () => {
  it("知らない値を弾く", () => {
    expect(isAnimeSort("popularity")).toBe(true);
    expect(isAnimeSort("release")).toBe(false);
  });
});
