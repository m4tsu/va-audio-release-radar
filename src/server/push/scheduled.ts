import { env } from "cloudflare:workers";
import { getDb } from "../db/client";
import { runDigest } from "./digest";
import { createPushSender } from "./send";
import { vapidFromEnv } from "./vapid";

/**
 * cron の起動 1 回分。`src/worker.ts` の `scheduled` から呼ぶ。
 *
 * 時刻は起動時の実時刻を使う。cron は予定時刻 (金曜 18:00 JST) から数時間のあいだ数分おきに
 * 起動し、どの起動も同じ予定時刻に丸められる (`slot.ts`)。
 * 結果は 1 行の JSON でログに残す。D1 の走行の記録 (`push_digest_runs`) と同じ数字
 */
export async function runScheduledDigest(): Promise<void> {
  const vapid = vapidFromEnv(env);
  const result = await runDigest(getDb(), {
    now: new Date().toISOString(),
    send: vapid ? createPushSender(vapid) : null,
  });
  console.log(JSON.stringify({ event: "push-digest", ...result }));
}
