import type { Locale } from "@/app/i18n";
import type { ActorSummary } from "@/app/lib/view-types";
import { type StoreSlug, VOICE_ACTOR_GENDERS } from "@/domain/types";

/**
 * 声優一覧の並べ替えと絞り込み。
 *
 * どれもブラウザの中だけで完結させる。画面は声優全員ぶんを受け取っているので、
 * 操作のたびにサーバーへ取りに行く理由が無い。描く行数の上限は画面が持つので、
 * ここは全員を並べ替えて絞り込んだ結果を返す。既定の並べ替えも初回描画でここを通るので、
 * SSR が返す HTML が既に既定の並びになっている
 */

/**
 * 並べ替えの選択肢。
 *
 * 既定は作品数の多い順。名前順は日本語表示では漢字表記の内部順序なので、
 * 開いた最初の画面に手がかりが無い
 */
export const ACTOR_SORTS = ["name", "workCount"] as const;
export type ActorSort = (typeof ACTOR_SORTS)[number];
export const DEFAULT_ACTOR_SORT: ActorSort = "workCount";

export function isActorSort(value: string): value is ActorSort {
  return (ACTOR_SORTS as readonly string[]).includes(value);
}

/**
 * 性別の絞り込みの選択肢。絞らない "all" に DB の列挙 (`VoiceActorGender`) をそのまま並べる。
 *
 * DB の値から作るのは、一覧の全員がどれか 1 つに必ず入る状態を型と実行時の両方で保つため。
 * "other" (女性でも男性でもないと分かっている) と "unknown" (分かっていない) を
 * 画面側で 1 つに畳むと、前者が後者の人数に埋もれて辿れなくなる
 */
export const ACTOR_GENDER_FILTERS = ["all", ...VOICE_ACTOR_GENDERS] as const;
export type ActorGenderFilter = (typeof ACTOR_GENDER_FILTERS)[number];
export const DEFAULT_ACTOR_GENDER_FILTER: ActorGenderFilter = "all";

/** 並べ替えと絞り込みに要る列だけ。テストから丸ごとの行を組み立てずに済ませる */
type DirectoryActor = Pick<ActorSummary, "workCount" | "storeSlugs" | "nameEn" | "gender">;

export type ActorArrangement = {
  sort: ActorSort;
  /** null はストアで絞っていない状態 */
  store: StoreSlug | null;
  /** "all" は性別で絞っていない状態 */
  gender: ActorGenderFilter;
  /** 頭文字 (A-Z の 1 文字)。null は頭文字で絞っていない状態。日本語表示では見ない */
  initial: string | null;
  /** 名前順の並びと頭文字の絞り込みは表示言語で変わる */
  locale: Locale;
};

/** 絞り込んでから並べ替える。元の配列は書き換えない */
export function arrangeActors<T extends DirectoryActor>(
  actors: readonly T[],
  { sort, store, gender, initial, locale }: ActorArrangement,
): T[] {
  const narrowed = narrow(actors, store, gender);
  const filtered =
    initial === null ? narrowed : narrowed.filter((a) => actorInitial(a, locale) === initial);
  return sortActors(filtered, sort, locale);
}

/**
 * 選べる頭文字。
 *
 * ストアと性別で絞った後の顔ぶれから作る。押した結果が 0 人になる文字を出さないため
 */
export function availableInitials<T extends DirectoryActor>(
  actors: readonly T[],
  { store, gender, locale }: Pick<ActorArrangement, "store" | "gender" | "locale">,
): string[] {
  const initials = new Set<string>();
  for (const actor of narrow(actors, store, gender)) {
    const initial = actorInitial(actor, locale);
    if (initial !== null) initials.add(initial);
  }
  // A-Z しか入らないので、既定の比較 (コードポイント順) がそのままアルファベット順になる
  return [...initials].sort();
}

/**
 * 頭文字。英語表示で、ローマ字の姓が A-Z で始まる声優だけが持つ。
 *
 * 持たない声優は頭文字での絞り込みに出てこない。絞っていない一覧には出る
 */
export function actorInitial(actor: Pick<DirectoryActor, "nameEn">, locale: Locale): string | null {
  if (locale !== "en" || actor.nameEn === undefined) return null;
  const head = nameSortKeyEn(actor.nameEn).slice(0, 1).toUpperCase();
  return /^[A-Z]$/.test(head) ? head : null;
}

/**
 * 頭文字より前に効く絞り込み (ストアと性別)。
 *
 * 押せる頭文字を数えるときと、一覧を絞るときの両方から呼ぶ。
 * 別々に絞ると「押した結果が 0 人になる頭文字」が出る
 */
function narrow<T extends DirectoryActor>(
  actors: readonly T[],
  store: StoreSlug | null,
  gender: ActorGenderFilter,
): T[] {
  const inStore = store === null ? [...actors] : actors.filter((a) => a.storeSlugs.includes(store));
  // "all" 以外は DB の値そのものなので、言い換えずに等値で見る
  return gender === "all" ? inStore : inStore.filter((a) => a.gender === gender);
}

/**
 * 英語表記の並べ替えキー。
 *
 * `voice_actors.name_en` は AniList の fullName 由来で名が先に来る ("Reina Ueda")。
 * 姓から引ける並びにするため、最後の語を先頭へ回す ("Ueda Reina")。
 * 「ゆかな」のように 1 語の名義はその語だけになる。
 *
 * 語に割ってから組み直すので、前後や語間の空白はキーに残らない。空白が頭に付くと
 * どの A-Z より前に並び、頭文字も取れなくなる
 */
function nameSortKeyEn(nameEn: string): string {
  const parts = nameEn.split(/\s+/).filter((part) => part !== "");
  const surname = parts.at(-1);
  if (surname === undefined) return "";
  return [surname, ...parts.slice(0, -1)].join(" ");
}

/**
 * 並べ替え。日本語表示の "name" は受け取った順 (`listActors` の canonical_name 順) をそのまま使う。
 *
 * ここで日本語の名前を並べ直すと、SQLite のコードポイント順と `localeCompare` の結果がずれ、
 * ハイドレーションの前後で並びが入れ替わって見える。日本語の名前順はサーバーが決めた順を使う。
 *
 * 英語表示の "name" はローマ字の姓から並べる。漢字表記の内部順序は英語話者の手がかりにならない
 */
function sortActors<T extends DirectoryActor>(actors: T[], sort: ActorSort, locale: Locale): T[] {
  // Array#sort は安定なので、比較が同じ声優は受け取った順のまま残る
  if (sort === "workCount") return actors.sort((a, b) => b.workCount - a.workCount);
  if (locale !== "en") return actors;
  return actors.sort(compareNameEn);
}

/**
 * ローマ字の比較。小文字に畳んでからコードポイント順で見る。
 *
 * `localeCompare` を使わないのは、SSR (workerd) とブラウザで結果が違うとハイドレーションの
 * 前後で並びが入れ替わるため。ローマ字は ASCII なのでコードポイント順が辞書順と一致する。
 * ローマ字を持たない声優は後ろにまとめる。英語表示でも一覧から消さないため
 */
function compareNameEn(a: DirectoryActor, b: DirectoryActor): number {
  if (a.nameEn === undefined || b.nameEn === undefined) {
    return (a.nameEn === undefined ? 1 : 0) - (b.nameEn === undefined ? 1 : 0);
  }
  const keyA = nameSortKeyEn(a.nameEn).toLowerCase();
  const keyB = nameSortKeyEn(b.nameEn).toLowerCase();
  if (keyA === keyB) return 0;
  return keyA < keyB ? -1 : 1;
}
