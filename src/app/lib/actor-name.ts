import type { Locale } from "@/app/i18n";

/**
 * 声優名の表示。
 *
 * 正は `canonicalName` (日本語表記)。`voice_actors.name_en` は AniList 由来の
 * ローマ字表記を入れる列で、現時点では全件 NULL。英語表示のときだけ、入っていればそちらを使う。
 * データが入れば追加の手当てなしで効く。
 *
 * 声優名そのものはストア / AniList 由来の値なので、ここで訳したり整形したりはしない
 */
export function actorDisplayName(
  actor: { canonicalName: string; nameEn?: string },
  locale: Locale,
): string {
  if (locale === "en" && actor.nameEn) return actor.nameEn;
  return actor.canonicalName;
}
