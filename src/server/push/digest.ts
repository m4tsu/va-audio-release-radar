import type { AppDb } from "../db/types";
import {
  actorNames,
  type DigestActorName,
  type DigestWork,
  type DueSubscription,
  deleteSubscriptionsById,
  digestWorks,
  dueSubscriptions,
  finishDigestRun,
  markDigestAttempted,
  markDigestDone,
  startDigestRun,
} from "../queries/push-digest";
import { digestMessage, type PushMessage } from "./message";
import type { PushSender } from "./send";
import { type DigestWindow, digestScheduledAt, digestWindow } from "./slot";

/**
 * 週 1 通のダイジェストの段取り。cron の起動 1 回分が `runDigest()`。
 *
 * 1 回の起動で送る数に上限を置き、残りは次の起動に持ち越す。Workers は 1 回の起動で外へ出られる
 * 回数に上限があり (D1 への問い合わせもそこに数える)、購読が増えても起動が落ちないようにする。
 * cron は予定時刻から数時間のあいだ数分おきに起動する (`wrangler.jsonc` の `triggers`)。
 * どの起動も同じ予定時刻 (`slot.ts`) を計算し、済んだ購読には印を付けるので、2 通は出ない。
 *
 * 新作の無い購読にも印を付ける。付けないと、その週の残りの起動で毎回引き直すことになる
 */

/** 1 回の起動で送る上限。無料プランの外向き 50 回のうち、D1 の読み書きに残す分を引いた値 */
export const DIGEST_SENDS_PER_RUN = 20;
/** 1 度に引く購読の数。送る数より多く引くのは、新作の無い購読が大半だから */
const PAGE_SIZE = 100;

export type DigestTarget = {
  subscription: DueSubscription;
  works: DigestWork[];
  message: PushMessage;
};

export type DigestPlan = {
  window: DigestWindow;
  /** 新作があり、送る対象になる購読 */
  targets: DigestTarget[];
  /** 追う声優に新作が無く、送らない購読 */
  skipped: DueSubscription[];
  /** このページで見た最後の購読 id。次のページはこれより後から引く。購読が無ければ null */
  lastId: number | null;
};

/**
 * 送る内容を組む。送らないので、手元で対象と本文を確かめるのにも使う (管理 API)。
 * `afterId` より後の購読を `limit` 件まで見る
 */
export async function planDigest(
  db: AppDb,
  options: { now: string; afterId?: number; limit?: number },
): Promise<DigestPlan> {
  const scheduledAt = digestScheduledAt(options.now);
  const window = digestWindow(scheduledAt);
  const subscriptions = await dueSubscriptions(
    db,
    scheduledAt,
    options.afterId ?? 0,
    options.limit ?? PAGE_SIZE,
  );
  if (subscriptions.length === 0) return { window, targets: [], skipped: [], lastId: null };

  const actorIds = [
    ...new Set(subscriptions.flatMap((subscription) => subscription.voiceActorIds)),
  ];
  const works = await digestWorks(db, actorIds, window);
  const worksByActor = new Map<string, DigestWork[]>();
  for (const work of works) {
    for (const actorId of work.actorIds) {
      const list = worksByActor.get(actorId) ?? [];
      list.push(work);
      worksByActor.set(actorId, list);
    }
  }
  const names = await actorNames(db, [...worksByActor.keys()]);

  const targets: DigestTarget[] = [];
  const skipped: DueSubscription[] = [];
  for (const subscription of subscriptions) {
    const own = new Map<string, DigestWork>();
    const actors: DigestActorName[] = [];
    for (const actorId of subscription.voiceActorIds) {
      const list = worksByActor.get(actorId);
      if (!list) continue;
      for (const work of list) own.set(work.id, work);
      const name = names.get(actorId);
      if (name) actors.push(name);
    }
    if (own.size === 0) {
      skipped.push(subscription);
      continue;
    }
    targets.push({
      subscription,
      works: [...own.values()],
      message: digestMessage(subscription.locale, own.size, actors),
    });
  }

  return {
    window,
    targets,
    skipped,
    lastId: subscriptions[subscriptions.length - 1]?.id ?? null,
  };
}

export type DigestRunResult = {
  scheduledAt: string;
  /** 走行の記録の id。鍵が無くて送らなかったときは null */
  runId: number | null;
  subscriptionCount: number;
  sentCount: number;
  expiredCount: number;
  failedCount: number;
  /** 送るものが無くなった (次の起動で見るものが無い) なら true */
  exhausted: boolean;
};

export type DigestRunDeps = {
  now: string;
  /** null は VAPID の鍵が無い。何も送らずログだけ残す */
  send: PushSender | null;
  sendLimit?: number;
  log?: (message: string) => void;
};

/** cron の起動 1 回分。送った結果を購読と走行の記録に書く */
export async function runDigest(db: AppDb, deps: DigestRunDeps): Promise<DigestRunResult> {
  const { now, send, sendLimit = DIGEST_SENDS_PER_RUN, log = console.log } = deps;
  const scheduledAt = digestScheduledAt(now);
  const empty = {
    scheduledAt,
    runId: null,
    subscriptionCount: 0,
    sentCount: 0,
    expiredCount: 0,
    failedCount: 0,
    exhausted: false,
  };
  if (send === null) {
    log("VAPID の鍵か subject が未設定なので、ダイジェストを送らない");
    return empty;
  }

  const runId = await startDigestRun(db, scheduledAt, now);
  const counts = { subscriptionCount: 0, sentCount: 0, expiredCount: 0, failedCount: 0 };
  let afterId = 0;
  let exhausted = false;

  while (counts.subscriptionCount < sendLimit) {
    const plan = await planDigest(db, { now, afterId, limit: PAGE_SIZE });
    if (plan.lastId === null) {
      exhausted = true;
      break;
    }
    // 新作の無い購読はこの週は済み。送信を試みていないので日時は残さない
    await markDigestDone(
      db,
      plan.skipped.map((subscription) => subscription.id),
      scheduledAt,
      null,
    );

    const sent: number[] = [];
    const expired: number[] = [];
    const failed: number[] = [];
    let stoppedAtLimit = false;
    for (const target of plan.targets) {
      if (counts.subscriptionCount >= sendLimit) {
        stoppedAtLimit = true;
        break;
      }
      counts.subscriptionCount += 1;
      const outcome = await send(target.subscription, target.message);
      if (outcome.kind === "sent") sent.push(target.subscription.id);
      else if (outcome.kind === "expired") expired.push(target.subscription.id);
      else {
        failed.push(target.subscription.id);
        log(
          `購読 ${target.subscription.id} に送れなかった: ${outcome.status ?? outcome.error ?? "不明"}`,
        );
      }
    }
    counts.sentCount += sent.length;
    counts.expiredCount += expired.length;
    counts.failedCount += failed.length;
    await markDigestDone(db, sent, scheduledAt, now);
    await deleteSubscriptionsById(db, expired);
    await markDigestAttempted(db, failed, now);

    // 上限で止めた分は印が付いていないので、次の起動が同じ予定時刻で引き直す
    if (stoppedAtLimit) break;
    afterId = plan.lastId;
  }

  await finishDigestRun(db, runId, new Date().toISOString(), counts);
  return { scheduledAt, runId, ...counts, exhausted };
}
