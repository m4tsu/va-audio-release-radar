import { DEFAULT_LOCALE, type Locale, translate } from "@/app/i18n";
import type { AnimeSeason } from "@/domain/types";
import { ANIME_SEASONS } from "@/domain/types";

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
