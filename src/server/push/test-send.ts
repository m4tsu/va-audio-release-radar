import type { AppDb } from "../db/types";
import { getPushTargetById } from "../queries/push-subscriptions";
import { testMessage } from "./message";
import type { PushSender, SendOutcome } from "./send";

/**
 * 購読 1 件に試しの通知を送る。ダイジェストの段取り (`digest.ts`) は通らず、送信の記録も付けない。
 *
 * 失効 (404 / 410) が返っても購読は消さない。試しの送信は様子を見るためのもので、
 * 消すかどうかは cron の送信に任せる
 */
export async function sendTestPush(
  db: AppDb,
  subscriptionId: number,
  send: PushSender,
): Promise<SendOutcome | { kind: "not_found" }> {
  const target = await getPushTargetById(db, subscriptionId);
  if (!target) return { kind: "not_found" };
  return send(target, testMessage(target.locale));
}
