import { eq, inArray } from "drizzle-orm";
import type { Locale, PushSubscriptionInput } from "@/domain/types";
import { chunked, SQL_IN_CHUNK_SIZE } from "../db/chunked";
import { pushSubscriptionActors, pushSubscriptions, voiceActors } from "../db/schema";
import type { AppDb } from "../db/types";

/**
 * Web Push の購読の保存と削除。
 *
 * 入力の検証はここに持たない。`@/domain/types` の `pushSubscriptionSchema` を通った
 * `PushSubscriptionInput` だけを受け取る。
 * 購読の単位は endpoint。同じ endpoint が再び届いたら鍵・言語・追う声優を丸ごと差し替える
 * (ブラウザは差分ではなく「今のフォロー全部」を送ってくる)
 */

export type SavedPushSubscription = {
  id: number;
  endpoint: string;
  locale: Locale;
  /** 実際に保存された声優。存在しない ID は黙って落ちる */
  voiceActorIds: string[];
};

/**
 * 購読を upsert し、追う声優を送られてきた集合に置き換える。
 *
 * 存在しない声優 ID は保存しない (外部キーで落ちる前にこちらで除く)。ブラウザの IndexedDB には
 * 追加だけの声優表から消えることのない ID しか入らないが、別の環境のフォローを持ち込んだときに
 * 全体が失敗するより、知っている分だけ保存する方が通知の目的に合う。
 *
 * 削除と挿入は 1 つの batch で送る。D1 の batch は 1 つのトランザクションになるので、
 * 途中で失敗して「追う声優が 0 人」の状態が残らない
 */
export async function savePushSubscription(
  db: AppDb,
  input: PushSubscriptionInput,
  now: string = new Date().toISOString(),
): Promise<SavedPushSubscription> {
  const [row] = await db
    .insert(pushSubscriptions)
    .values({
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      locale: input.locale,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { p256dh: input.p256dh, auth: input.auth, locale: input.locale, updatedAt: now },
    })
    .returning();
  if (!row) throw new Error("購読を保存できなかった");

  const actorIds = await knownActorIds(db, [...new Set(input.voiceActorIds)]);
  const clear = db
    .delete(pushSubscriptionActors)
    .where(eq(pushSubscriptionActors.subscriptionId, row.id));
  // 1 行 2 値なので、1 文の bound parameter が上限に収まる行数で切る
  const inserts = chunked(actorIds, Math.floor(SQL_IN_CHUNK_SIZE / 2)).map((chunk) =>
    db
      .insert(pushSubscriptionActors)
      .values(chunk.map((voiceActorId) => ({ subscriptionId: row.id, voiceActorId }))),
  );
  await db.batch([clear, ...inserts]);

  return { id: row.id, endpoint: row.endpoint, locale: row.locale, voiceActorIds: actorIds };
}

/** 購読を消す。追う声優の対は外部キーの cascade で一緒に消える。無かったなら false */
export async function deletePushSubscription(db: AppDb, endpoint: string): Promise<boolean> {
  const deleted = await db
    .delete(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, endpoint))
    .returning({ id: pushSubscriptions.id });
  return deleted.length > 0;
}

/** endpoint で購読を引く。追う声優は ID の昇順で返す */
export async function getPushSubscription(
  db: AppDb,
  endpoint: string,
): Promise<SavedPushSubscription | undefined> {
  const [row] = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, endpoint))
    .limit(1);
  if (!row) return undefined;
  const pairs = await db
    .select({ voiceActorId: pushSubscriptionActors.voiceActorId })
    .from(pushSubscriptionActors)
    .where(eq(pushSubscriptionActors.subscriptionId, row.id));
  return {
    id: row.id,
    endpoint: row.endpoint,
    locale: row.locale,
    voiceActorIds: pairs.map((pair) => pair.voiceActorId).sort(),
  };
}

/** 声優表にある ID だけを、入力の並びのまま返す */
async function knownActorIds(db: AppDb, ids: string[]): Promise<string[]> {
  const known = new Set<string>();
  for (const chunk of chunked(ids)) {
    const rows = await db
      .select({ id: voiceActors.id })
      .from(voiceActors)
      .where(inArray(voiceActors.id, chunk));
    for (const { id } of rows) known.add(id);
  }
  return ids.filter((id) => known.has(id));
}
