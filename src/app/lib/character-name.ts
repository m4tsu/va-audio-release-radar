import type { Locale } from "@/app/i18n";

/**
 * 役名の表示。
 *
 * 正は `characterNameNative` (日本語表記)。`anime_appearances.character_name_full` は
 * AniList 由来の英語表記で、入っていない出演がある。英語表示でも無ければ日本語表記のまま出す。
 * 役名は「この人どのキャラの人だっけ」に答えるための手がかりなので、消すより出すほうがよい。
 *
 * 役名は AniList 由来の値なので、ここで訳したり整形したりはしない
 */
export function characterDisplayName(
  appearance: { characterNameNative: string; characterNameFull?: string },
  locale: Locale,
): string {
  const native = appearance.characterNameNative;
  const full = appearance.characterNameFull ?? "";
  if (locale === "en") return full || native;
  // AniList に日本語表記が無い役があり、取り込みは空文字で入る (`upsertAnime`)。
  // 日本語表示でも役名の欄を空にするより英語表記を出す
  return native || full;
}
