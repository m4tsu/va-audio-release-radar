import { normalizeName } from "./normalize.ts";
import type { CreditConfidence, VoiceActor, VoiceActorAlias } from "./types.ts";

export type ResolvedCredit = {
  voiceActorId?: string;
  confidence: CreditConfidence;
};

/**
 * ストア上のクレジット表記から声優を特定する (設計書 §4 / 企画書 §9 の 4 段階)。
 *
 * 1. `creditedName` が `canonicalName` と完全一致 → verified
 * 2. `creditedName` が検証済み (`verified: true`) エイリアスと完全一致 → verified
 * 3. `normalizeName` した結果が `canonicalName` またはエイリアス (検証済みでなくてもよい) と
 *    一致 → verified
 * 4. どれにも一致しなければ unmatched (`voiceActorId` 無し)。管理画面の未解決キューに出す
 *
 * LLM や類似度による推測マージはしない。また、どの段階であっても複数の声優に一致した場合
 * (同名の声優が別にいる場合) は、誤マッチより取りこぼしを選び unmatched にする
 */
export function resolveCredit(
  creditedName: string,
  actors: VoiceActor[],
  aliases: VoiceActorAlias[],
): ResolvedCredit {
  const canonicalMatches = new Set(
    actors.filter((actor) => actor.canonicalName === creditedName).map((actor) => actor.id),
  );
  const canonicalResult = toResolvedCredit(pickUnique(canonicalMatches));
  if (canonicalResult) return canonicalResult;

  const verifiedAliasMatches = new Set(
    aliases
      .filter((alias) => alias.verified && alias.name === creditedName)
      .map((alias) => alias.voiceActorId),
  );
  const verifiedAliasResult = toResolvedCredit(pickUnique(verifiedAliasMatches));
  if (verifiedAliasResult) return verifiedAliasResult;

  const normalizedCredited = normalizeName(creditedName);
  const normalizedMatches = new Set<string>();
  for (const actor of actors) {
    if (normalizeName(actor.canonicalName) === normalizedCredited) {
      normalizedMatches.add(actor.id);
    }
  }
  for (const alias of aliases) {
    if (normalizeName(alias.name) === normalizedCredited) {
      normalizedMatches.add(alias.voiceActorId);
    }
  }
  const normalizedResult = toResolvedCredit(pickUnique(normalizedMatches));
  if (normalizedResult) return normalizedResult;

  return { confidence: "unmatched" };
}

type UniquePick = { kind: "none" } | { kind: "one"; id: string } | { kind: "ambiguous" };

/** 集合が 1 件だけならその要素を、0 件なら none、2 件以上なら ambiguous を返す */
function pickUnique(ids: Set<string>): UniquePick {
  if (ids.size === 0) return { kind: "none" };
  if (ids.size > 1) return { kind: "ambiguous" };
  const first = ids.values().next();
  // size === 1 なので done は必ず false
  return first.done ? { kind: "none" } : { kind: "one", id: first.value };
}

/** none ならこの段階では未確定なので次の段階に進ませる (undefined を返す) */
function toResolvedCredit(pick: UniquePick): ResolvedCredit | undefined {
  switch (pick.kind) {
    case "one":
      return { voiceActorId: pick.id, confidence: "verified" };
    case "ambiguous":
      return { confidence: "unmatched" };
    case "none":
      return undefined;
  }
}
