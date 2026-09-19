import type { ActorSummary } from "@/app/lib/view-types";
import type { StoreSlug } from "@/domain/types";

/**
 * 声優一覧の並べ替えと絞り込み。
 *
 * どちらもブラウザの中だけで完結させる。一覧は作品のある声優を全員 SSR で出しているので、
 * 操作のたびにサーバーへ取りに行く理由が無く、初期表示 (= 検索エンジンが見る HTML) も
 * 絞り込み前のまま保てる。既定の並べ替えも初回描画でここを通るので、SSR が返す HTML が
 * 既に既定の並びになっている
 */

/**
 * 並べ替えの選択肢。
 *
 * 既定は作品数の多い順。名前順は漢字表記の内部順序なので、開いた最初の画面に手がかりが無い
 */
export const ACTOR_SORTS = ["name", "workCount"] as const;
export type ActorSort = (typeof ACTOR_SORTS)[number];
export const DEFAULT_ACTOR_SORT: ActorSort = "workCount";

export function isActorSort(value: string): value is ActorSort {
  return (ACTOR_SORTS as readonly string[]).includes(value);
}

/** 並べ替えと絞り込みに要る列だけ。テストから丸ごとの行を組み立てずに済ませる */
type DirectoryActor = Pick<ActorSummary, "workCount" | "storeSlugs">;

export type ActorArrangement = {
  sort: ActorSort;
  /** null はストアで絞っていない状態 */
  store: StoreSlug | null;
};

/** 絞り込んでから並べ替える。元の配列は書き換えない */
export function arrangeActors<T extends DirectoryActor>(
  actors: readonly T[],
  { sort, store }: ActorArrangement,
): T[] {
  const filtered =
    store === null ? [...actors] : actors.filter((a) => a.storeSlugs.includes(store));
  return sortActors(filtered, sort);
}

/**
 * 並べ替え。"name" は受け取った順 (`listActors` の canonical_name 順) をそのまま使う。
 *
 * ここで名前を並べ直すと、SQLite のコードポイント順と `localeCompare` の結果がずれ、
 * ハイドレーションの前後で並びが入れ替わって見える。名前順の正はサーバーに置く
 */
function sortActors<T extends DirectoryActor>(actors: T[], sort: ActorSort): T[] {
  if (sort === "name") return actors;
  // Array#sort は安定なので、作品数が同じ声優は名前順のまま残る
  return actors.sort((a, b) => b.workCount - a.workCount);
}
