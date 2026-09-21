/**
 * 週 1 通のダイジェストの「予定時刻」とその週の範囲。
 *
 * 予定時刻は金曜 18:00 JST。cron は UTC で書くので 09:00 UTC (`wrangler.jsonc` の `triggers`)。
 * 送信は上限で区切って複数回の起動に持ち越すため、どの起動も「直近の予定時刻」を同じ値として
 * 計算し、購読の `last_digest_scheduled_at` との一致で送信済みを判定する
 * (`src/server/db/schema.ts` の `push_subscriptions`)
 */

import { RECENT_DAYS } from "../queries/works";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
/** 金曜。`Date.getUTCDay()` の値 */
const DIGEST_WEEKDAY_UTC = 5;
/** 18:00 JST */
const DIGEST_HOUR_UTC = 9;
/** JST の日付を得るためのずれ。発売日は JST の日付で入っているので、範囲の端も JST の日付にする */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export type DigestWindow = {
  /** この予定時刻のダイジェスト。ISO 8601 (UTC) */
  scheduledAt: string;
  /** 発売日の範囲 (JST の日付、両端を含む)。前の予定時刻の翌日からこの予定時刻の日まで */
  releaseDateFrom: string;
  releaseDateTo: string;
  /**
   * 発売日がこの日以降 `releaseDateFrom` より前で、この週に初めて見つかった作品も数える。
   * ストアに載るのが発売日より遅い、日次の取り込みが週の締めの後になる、のどちらでも
   * その作品は「発売日の週」を過ぎてから DB に入る。遡る幅はフィードの「最近の新作」と同じ
   */
  releaseDateLookbackFrom: string;
  /** 発売日の無い作品を見つけた日時の範囲。前の予定時刻より後、この予定時刻まで */
  discoveredAfter: string;
  discoveredUntil: string;
};

/** `now` 以前で直近の予定時刻 (金曜 09:00 UTC) */
export function digestScheduledAt(now: string): string {
  const time = Date.parse(now);
  const date = new Date(time);
  const candidate = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    DIGEST_HOUR_UTC,
  );
  const daysSinceFriday = (date.getUTCDay() - DIGEST_WEEKDAY_UTC + 7) % 7;
  let slot = candidate - daysSinceFriday * DAY_MS;
  if (slot > time) slot -= WEEK_MS;
  return new Date(slot).toISOString();
}

/** 予定時刻から、その週に「出た」とみなす範囲を決める */
export function digestWindow(scheduledAt: string): DigestWindow {
  const end = Date.parse(scheduledAt);
  const start = end - WEEK_MS;
  return {
    scheduledAt,
    // 前の予定時刻の日 (金曜) は前の週に数えたので、その翌日から
    releaseDateFrom: jstDate(start + DAY_MS),
    releaseDateTo: jstDate(end),
    releaseDateLookbackFrom: jstDate(end - RECENT_DAYS * DAY_MS),
    discoveredAfter: new Date(start).toISOString(),
    discoveredUntil: scheduledAt,
  };
}

/** 時刻を JST の日付 ("YYYY-MM-DD") にする */
function jstDate(time: number): string {
  return new Date(time + JST_OFFSET_MS).toISOString().slice(0, 10);
}
