/**
 * クレジット表示の重複排除。
 *
 * `audio_credits` は (audio_work_id, credited_name, source_store_slug) で一意なので、
 * 「上田麗奈」「上田 麗奈」のように表記違いで同じ声優に解決された credit が
 * 別行として複数残ることがある (名寄せは `resolveCredit` が表記ごとに行うため)。
 * 解決済み (voiceActorId あり) は声優単位で 1 回だけ出したいので voiceActorId で、
 * 未解決 (voiceActorId 無し) はストア上の表記そのものが「誰か」の代わりなので
 * creditedName で重複排除する。並び順は入力の最初の出現を保つ (純粋関数、DB や React に依存しない)
 */
type CreditKey = {
  voiceActorId?: string;
  creditedName: string;
};

export function dedupeCredits<T extends CreditKey>(credits: readonly T[]): T[];
export function dedupeCredits<T>(items: readonly T[], keySelector: (item: T) => CreditKey): T[];
export function dedupeCredits<T>(items: readonly T[], keySelector?: (item: T) => CreditKey): T[] {
  const toKey = keySelector ?? ((item: T) => item as unknown as CreditKey);
  const seenVoiceActorIds = new Set<string>();
  const seenCreditedNames = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    const { voiceActorId, creditedName } = toKey(item);
    if (voiceActorId) {
      if (seenVoiceActorIds.has(voiceActorId)) continue;
      seenVoiceActorIds.add(voiceActorId);
    } else {
      if (seenCreditedNames.has(creditedName)) continue;
      seenCreditedNames.add(creditedName);
    }
    result.push(item);
  }

  return result;
}
