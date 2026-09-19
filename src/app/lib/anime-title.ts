import type { Locale } from "@/app/i18n";

/** 表示名を決めるのに要るアニメ名の組。画面が扱う型 (`AnimeSummary` など) はどれもこれを満たす */
export type AnimeTitleSource = {
  titleNative: string;
  titleRomaji: string;
  titleEnglish?: string;
};

/**
 * アニメ名の表示。
 *
 * 正は `titleNative` (AniList の native 表記)。`anime_titles.title_english` は AniList で
 * 実際に null のことがあるので、英語表示では英語名 → ローマ字名の順に落とす。日本語名には戻さない。
 * ローマ字なら英語の読者にも読めるが、日本語名は読めないため。
 *
 * アニメ名は AniList 由来の値なので、ここで訳したり整形したりはしない
 */
export function animeDisplayTitle(anime: AnimeTitleSource, locale: Locale): string {
  if (locale !== "en") return anime.titleNative;
  return anime.titleEnglish || anime.titleRomaji;
}

/**
 * 見出しに出していないほうのアニメ名。アニメ詳細ページの副題に使う。
 *
 * 見出しと同じ名前を並べても手がかりが増えないので、表示言語を反転して同じ規則で決める
 */
export function animeAlternateTitle(anime: AnimeTitleSource, locale: Locale): string {
  return animeDisplayTitle(anime, locale === "en" ? "ja" : "en");
}
