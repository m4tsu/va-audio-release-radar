import { DEFAULT_LOCALE, type Locale, translate } from "@/app/i18n";
import type { AnimeSeason } from "@/domain/types";
import { ANIME_SEASONS, seasonOrder } from "@/domain/types";

/**
 * シーズンの表示と URL の相互変換。
 *
 * AniList は大文字 ("FALL") で返すが、URL には小文字で出す ("2026-fall")。
 * 大文字を URL に出すと、大小の揺れで同じページが二重に見えるため。
 * URL は言語によって変えない (言語は cookie で決まり、URL には出さない)
 */

const SEASON_KEYS = {
  WINTER: "season.winter",
  SPRING: "season.spring",
  SUMMER: "season.summer",
  FALL: "season.fall",
} as const;

/** "2026 年秋" / "Fall 2026"。年と季節の並びも言語で変わるので辞書側に持たせる */
export function seasonLabel(
  year: number,
  season: AnimeSeason,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return translate(locale, "season.label", {
    year,
    season: translate(locale, SEASON_KEYS[season]),
  });
}

/** URL に出す "2026-fall" */
export function toSeasonSlug(year: number, season: AnimeSeason): string {
  return `${year}-${season.toLowerCase()}`;
}

/** "2026-fall" を年とシーズンに戻す。読めなければ undefined (呼び出し側で 404 にする) */
export function parseSeasonSlug(
  value: string,
): { seasonYear: number; season: AnimeSeason } | undefined {
  const match = /^(\d{4})-([a-z]+)$/.exec(value);
  if (!match) return undefined;

  const year = Number(match[1]);
  const season = ANIME_SEASONS.find((candidate) => candidate.toLowerCase() === match[2]);
  if (season === undefined) return undefined;

  return { seasonYear: year, season };
}

/** 年とシーズンだけを持つもの。前後を決めるのに要るのはこの 2 つだけ */
export type SeasonKey = { seasonYear: number; season: AnimeSeason };

/** 日本時間と UTC の差。日付から期を決めるのに使う */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * その時点で放送中の期。1〜3 月が冬、4〜6 月が春、7〜9 月が夏、10〜12 月が秋。
 *
 * 日本時間の暦日で決める。UTC のままだと 10 月 1 日の朝 9 時まで夏のままになる。
 * `getMonth()` のような時刻帯ごとに変わる読み方をしないのは、動かす場所
 * (Workers は UTC、手元は地域の時刻帯) で結果を変えないため
 */
export function currentSeason(now: Date): SeasonKey {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  return { seasonYear: jst.getUTCFullYear(), season: seasonOfMonth(jst.getUTCMonth()) };
}

/** 0 起点の月 (0 = 1 月) から期を決める */
function seasonOfMonth(month: number): AnimeSeason {
  if (month < 3) return "WINTER";
  if (month < 6) return "SPRING";
  if (month < 9) return "SUMMER";
  return "FALL";
}

/**
 * `/anime` の先頭に出す期。放送中の期を出し、そこに出せる作品が無ければ
 * 古い方向でいちばん新しい期を出す。
 *
 * 古い方向にも無い (持っているのが放送前の期だけ) ときは、いちばん古い期を出す。
 * 出せる作品がある期が 1 つでもあれば画面に一覧が出る状態を保つため。
 * undefined を返すのは `seasons` が空のときだけ
 */
export function featuredSeason(seasons: readonly SeasonKey[], now: Date): SeasonKey | undefined {
  // 引数の並び順に頼らない (`adjacentSeasons` と同じ理由)
  const sorted = [...seasons].sort((a, b) => seasonOrder(a) - seasonOrder(b));
  const current = seasonOrder(currentSeason(now));
  const picked = sorted.findLast((item) => seasonOrder(item) <= current) ?? sorted[0];
  return picked ? { seasonYear: picked.seasonYear, season: picked.season } : undefined;
}

/**
 * `seasons` の中で `current` の 1 つ前 (古い) と 1 つ後 (新しい) にあたるもの。
 *
 * 隣を「年とシーズンを 1 つずらした値」で作らない。作品の無いシーズンが間に挟まると
 * 空の一覧へ送ってしまうため、実際に作品があるシーズンの並びから隣を取る。
 * いちばん古い / 新しいシーズンでは、その向きが undefined になる
 */
export function adjacentSeasons(
  seasons: readonly SeasonKey[],
  current: SeasonKey,
): { older?: SeasonKey; newer?: SeasonKey } {
  // 引数の並び順に頼らない。呼び出し側が並べ替えを変えても結果が変わらないようにする
  const sorted = [...seasons].sort((a, b) => seasonOrder(a) - seasonOrder(b));
  const index = sorted.findIndex((item) => seasonOrder(item) === seasonOrder(current));
  if (index < 0) return {};

  const older = sorted[index - 1];
  const newer = sorted[index + 1];
  return { ...(older ? { older } : {}), ...(newer ? { newer } : {}) };
}
