import { and, asc, eq, gt, gte, inArray, isNull, lte, ne, or } from "drizzle-orm";
import type { Locale } from "@/domain/types";
import { chunked } from "../db/chunked";
import {
  audioCredits,
  audioWorks,
  pushDigestRuns,
  pushSubscriptionActors,
  pushSubscriptions,
  storeListings,
  voiceActors,
} from "../db/schema";
import type { AppDb } from "../db/types";
import type { DigestWindow } from "../push/slot";
import { discoveredAfterBaseline, loadCrawlBaselines, loadListings, notAdultRated } from "./works";

/**
 * ダイジェスト送信のための読み書き。段取りそのものは `src/server/push/digest.ts`。
 *
 * 「その週に出た作品」の判定はフィードの「最近の新作」と同じ規則
 * (`works.ts` の `withinPeriod` と `classifyWork`): 発売日があればその日付、無ければ
 * 初回クロール以降に見つかった日時。範囲だけが「直近 30 日」から「前の予定時刻からこの予定時刻まで」に変わる
 */

export type DueSubscription = {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  locale: Locale;
  voiceActorIds: string[];
};

/**
 * この予定時刻のダイジェストをまだ送っていない購読を、id の昇順で `limit` 件。
 * `afterId` より大きい id だけを見るので、同じ起動の中で失敗した購読を二度引かない
 */
export async function dueSubscriptions(
  db: AppDb,
  scheduledAt: string,
  afterId: number,
  limit: number,
): Promise<DueSubscription[]> {
  const rows = await db
    .select()
    .from(pushSubscriptions)
    .where(
      and(
        gt(pushSubscriptions.id, afterId),
        or(
          isNull(pushSubscriptions.lastDigestScheduledAt),
          ne(pushSubscriptions.lastDigestScheduledAt, scheduledAt),
        ),
      ),
    )
    .orderBy(asc(pushSubscriptions.id))
    .limit(limit);
  if (rows.length === 0) return [];

  const actorsBySubscription = new Map<number, string[]>();
  for (const ids of chunked(rows.map((row) => row.id))) {
    const pairs = await db
      .select({
        subscriptionId: pushSubscriptionActors.subscriptionId,
        voiceActorId: pushSubscriptionActors.voiceActorId,
      })
      .from(pushSubscriptionActors)
      .where(inArray(pushSubscriptionActors.subscriptionId, ids));
    for (const pair of pairs) {
      const list = actorsBySubscription.get(pair.subscriptionId) ?? [];
      list.push(pair.voiceActorId);
      actorsBySubscription.set(pair.subscriptionId, list);
    }
  }

  return rows.map((row) => ({
    id: row.id,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    locale: row.locale,
    voiceActorIds: (actorsBySubscription.get(row.id) ?? []).sort(),
  }));
}

export type DigestWork = {
  id: string;
  title: string;
  releaseDate: string | null;
  /** 渡した声優のうち、この作品に出ている人 */
  actorIds: string[];
};

/**
 * 渡した声優のいずれかが出ていて、その週に出た作品。R18 は含めない。
 *
 * 発売日の無い作品は、その声優の初回クロールより後に見つかったものだけ。初回クロールは
 * 既存の全作品を一度に見つけるので、そこを起点にしないと声優を追加した週に過去作が全部届く
 */
export async function digestWorks(
  db: AppDb,
  actorIds: string[],
  window: DigestWindow,
): Promise<DigestWork[]> {
  if (actorIds.length === 0) return [];
  const actorSet = new Set(actorIds);

  const inWindow = or(
    and(
      gte(audioWorks.releaseDate, window.releaseDateFrom),
      lte(audioWorks.releaseDate, window.releaseDateTo),
    ),
    and(
      isNull(audioWorks.releaseDate),
      gt(storeListings.firstSeenAt, window.discoveredAfter),
      lte(storeListings.firstSeenAt, window.discoveredUntil),
    ),
  );

  const works = new Map<string, DigestWork>();
  for (const ids of chunked(actorIds)) {
    const rows = await db
      .select({ id: audioWorks.id, title: audioWorks.title, releaseDate: audioWorks.releaseDate })
      .from(audioWorks)
      .innerJoin(audioCredits, eq(audioCredits.audioWorkId, audioWorks.id))
      .innerJoin(storeListings, eq(storeListings.audioWorkId, audioWorks.id))
      .where(and(inArray(audioCredits.voiceActorId, ids), notAdultRated, inWindow))
      .groupBy(audioWorks.id);
    for (const row of rows) works.set(row.id, { ...row, actorIds: [] });
  }
  if (works.size === 0) return [];

  const workIds = [...works.keys()];
  for (const ids of chunked(workIds)) {
    const credits = await db
      .select({ audioWorkId: audioCredits.audioWorkId, voiceActorId: audioCredits.voiceActorId })
      .from(audioCredits)
      .where(inArray(audioCredits.audioWorkId, ids));
    for (const credit of credits) {
      if (credit.voiceActorId === null || !actorSet.has(credit.voiceActorId)) continue;
      works.get(credit.audioWorkId)?.actorIds.push(credit.voiceActorId);
    }
  }

  // 発売日の無い作品だけ、初回クロールの基準に照らす
  const undated = [...works.values()].filter((work) => work.releaseDate === null);
  if (undated.length > 0) {
    const [listings, baselines] = await Promise.all([
      loadListings(
        db,
        undated.map((work) => work.id),
      ),
      loadCrawlBaselines(db),
    ]);
    for (const work of undated) {
      const found = discoveredAfterBaseline(listings.get(work.id) ?? [], work.actorIds, baselines);
      const inRange =
        found !== undefined && found > window.discoveredAfter && found <= window.discoveredUntil;
      if (!inRange) works.delete(work.id);
    }
  }

  return [...works.values()]
    .map((work) => ({ ...work, actorIds: work.actorIds.sort() }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

export type DigestActorName = { canonicalName: string; nameEn: string | null };

/** 通知の本文に出す名前 */
export async function actorNames(
  db: AppDb,
  actorIds: string[],
): Promise<Map<string, DigestActorName>> {
  const names = new Map<string, DigestActorName>();
  for (const ids of chunked(actorIds)) {
    const rows = await db
      .select({
        id: voiceActors.id,
        canonicalName: voiceActors.canonicalName,
        nameEn: voiceActors.nameEn,
      })
      .from(voiceActors)
      .where(inArray(voiceActors.id, ids));
    for (const row of rows)
      names.set(row.id, { canonicalName: row.canonicalName, nameEn: row.nameEn });
  }
  return names;
}

/** 送った (または送るものが無かった) 購読に、この予定時刻を済んだ印として付ける */
export async function markDigestDone(
  db: AppDb,
  ids: number[],
  scheduledAt: string,
  attemptedAt: string | null,
): Promise<void> {
  for (const chunk of chunked(ids)) {
    await db
      .update(pushSubscriptions)
      .set(
        attemptedAt === null
          ? { lastDigestScheduledAt: scheduledAt }
          : { lastDigestScheduledAt: scheduledAt, lastAttemptedAt: attemptedAt },
      )
      .where(inArray(pushSubscriptions.id, chunk));
  }
}

/** 送れなかった購読。予定時刻は付けず、試みた日時だけ残す。次の起動で送り直す */
export async function markDigestAttempted(db: AppDb, ids: number[], attemptedAt: string) {
  for (const chunk of chunked(ids)) {
    await db
      .update(pushSubscriptions)
      .set({ lastAttemptedAt: attemptedAt })
      .where(inArray(pushSubscriptions.id, chunk));
  }
}

/** 失効した購読を消す。追う声優の対は外部キーの cascade で一緒に消える */
export async function deleteSubscriptionsById(db: AppDb, ids: number[]): Promise<void> {
  for (const chunk of chunked(ids)) {
    await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, chunk));
  }
}

export type DigestRunCounts = {
  subscriptionCount: number;
  sentCount: number;
  expiredCount: number;
  failedCount: number;
};

/** 走行の始めに 1 行書く。途中で止まった走行は `finished_at` が NULL のまま残る */
export async function startDigestRun(
  db: AppDb,
  scheduledAt: string,
  startedAt: string,
): Promise<number> {
  const [row] = await db
    .insert(pushDigestRuns)
    .values({ digestScheduledAt: scheduledAt, startedAt })
    .returning({ id: pushDigestRuns.id });
  if (!row) throw new Error("走行の記録を書けなかった");
  return row.id;
}

export async function finishDigestRun(
  db: AppDb,
  runId: number,
  finishedAt: string,
  counts: DigestRunCounts,
): Promise<void> {
  await db
    .update(pushDigestRuns)
    .set({ finishedAt, ...counts })
    .where(eq(pushDigestRuns.id, runId));
}
