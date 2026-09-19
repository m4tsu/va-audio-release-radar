import { describe, expect, test } from "vitest";
import type { StoreSlug } from "@/domain/types";
import { arrangeActors, DEFAULT_ACTOR_SORT, isActorSort } from "./actor-directory";

type Row = { slug: string; workCount: number; storeSlugs: StoreSlug[] };

/** サーバーが返す順 (canonical_name 順) に並んだ 3 人 */
const ACTORS: Row[] = [
  { slug: "a", workCount: 1, storeSlugs: ["dlsite"] },
  { slug: "b", workCount: 5, storeSlugs: ["audible", "pokedora"] },
  { slug: "c", workCount: 5, storeSlugs: ["dlsite", "audible"] },
];

const slugs = (rows: Row[]) => rows.map((row) => row.slug);

describe("arrangeActors", () => {
  test("既定は名前順で、サーバーが返した順のまま", () => {
    expect(slugs(arrangeActors(ACTORS, { sort: DEFAULT_ACTOR_SORT, store: null }))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  test("作品数の多い順では作品数の多い声優が先に来る", () => {
    expect(slugs(arrangeActors(ACTORS, { sort: "workCount", store: null }))).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  /** 同数のたびに並びが入れ替わると、操作するたびに別の画面に見える */
  test("作品数が同じなら名前順のまま残る", () => {
    const arranged = arrangeActors(ACTORS, { sort: "workCount", store: null });
    expect(slugs(arranged).slice(0, 2)).toEqual(["b", "c"]);
  });

  test("ストアを選ぶとそのストアに作品がある声優だけになる", () => {
    expect(slugs(arrangeActors(ACTORS, { sort: "name", store: "dlsite" }))).toEqual(["a", "c"]);
    expect(slugs(arrangeActors(ACTORS, { sort: "name", store: "pokedora" }))).toEqual(["b"]);
  });

  test("絞り込んだ結果が 0 人になることもある", () => {
    const onlyDlsite: Row[] = [{ slug: "a", workCount: 1, storeSlugs: ["dlsite"] }];
    expect(arrangeActors(onlyDlsite, { sort: "name", store: "audible" })).toEqual([]);
  });

  test("絞り込んでから並べ替える", () => {
    expect(slugs(arrangeActors(ACTORS, { sort: "workCount", store: "dlsite" }))).toEqual([
      "c",
      "a",
    ]);
  });

  test("渡された配列を書き換えない", () => {
    const before = slugs(ACTORS);
    arrangeActors(ACTORS, { sort: "workCount", store: null });
    expect(slugs(ACTORS)).toEqual(before);
  });
});

describe("isActorSort", () => {
  test("知らない値は受け取らない", () => {
    expect(isActorSort("name")).toBe(true);
    expect(isActorSort("workCount")).toBe(true);
    expect(isActorSort("releaseDate")).toBe(false);
  });
});
