import type { Locale } from "@/app/i18n";

/**
 * 声優名の表示。
 *
 * 正は `canonicalName` (日本語表記)。`voice_actors.name_en` は AniList 由来の
 * ローマ字表記を入れる列 (生成は `src/domain/actor-slug.ts`)。
 * 英語表示のときだけ、入っていればそちらを使う。AniList にローマ字が無い声優は NULL のままなので、
 * 英語表示でも漢字表記に落ちる。名前が消えるよりは読める表記が出るほうがよい。
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

/**
 * クレジット 1 件の表示名。名寄せ済みなら声優の表示名、未解決ならストア上の表記のまま
 * (確証の無い同一視をしない)。作品ページの本文と meta description で同じ名前を出すために 1 つにしている
 */
export function creditDisplayName(
  credit: { creditedName: string; voiceActorName?: string; voiceActorNameEn?: string },
  locale: Locale,
): string {
  if (!credit.voiceActorName) return credit.creditedName;
  return actorDisplayName(
    { canonicalName: credit.voiceActorName, nameEn: credit.voiceActorNameEn },
    locale,
  );
}
