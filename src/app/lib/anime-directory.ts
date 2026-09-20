import type { SeasonAnime } from "@/app/lib/view-types";

/**
 * シーズンのアニメ一覧の並べ替え。
 *
 * サーバーは既定の並び (人気の高い順) で返すので、切り替えたときだけここで並べ直す。
 * 声優一覧 (`actor-directory.ts`) と同じで、操作のたびにサーバーへ取りに行かない
 */

/**
 * 並べ替えの選択肢。
 *
 * 既定は人気順。出演者の人数順にすると、探している作品ではなく出演者の多い群像劇が上に来る
 */
export const ANIME_SORTS = ["popularity", "actorCount"] as const;
export type AnimeSort = (typeof ANIME_SORTS)[number];
export const DEFAULT_ANIME_SORT: AnimeSort = "popularity";

export function isAnimeSort(value: string): value is AnimeSort {
  return (ANIME_SORTS as readonly string[]).includes(value);
}

/** 並べ替えに要る列だけ。テストから丸ごとの行を組み立てずに済ませる */
type SortableAnime = Pick<SeasonAnime, "actorCount">;

/**
 * 並べ替える。元の配列は書き換えない。
 *
 * "popularity" は受け取った順 (`listSeasonAnime` の人気順) をそのまま使う。
 * 人気度を持たない作品の位置と同順位の扱いをサーバーと画面で二重に決めると、
 * ハイドレーションの前後で並びが入れ替わって見える
 */
export function sortSeasonAnime<T extends SortableAnime>(
  anime: readonly T[],
  sort: AnimeSort,
): T[] {
  if (sort === "popularity") return [...anime];
  // Array#sort は安定なので、出演者が同数の作品は人気順のまま残る
  return [...anime].sort((a, b) => b.actorCount - a.actorCount);
}
