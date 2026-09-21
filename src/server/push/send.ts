import { buildPushPayload, type VapidKeys } from "@block65/webcrypto-web-push";
import type { PushMessage } from "./message";

/**
 * push service への 1 通の送信。
 *
 * 暗号化 (RFC 8291) と VAPID の署名 (RFC 8292) は `@block65/webcrypto-web-push` に任せる。
 * WebCrypto だけで動くので Worker で使える。外へ出る fetch はここの 1 箇所だけで、
 * 相手はブラウザが購読時に告げた endpoint (`https:` に限る。`pushSubscriptionSchema`)
 */

export type PushTarget = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type SendOutcome =
  | { kind: "sent" }
  /** 購読が無効。push service が 404 か 410 を返した。購読は消してよい */
  | { kind: "expired"; status: number }
  /** 一時的な失敗。購読は残し、次の起動で送り直す */
  | { kind: "failed"; status?: number; error?: string };

/**
 * 通知が届くまでに push service が預かる時間。ブラウザが閉じていても 1 週間以内に開けば届く。
 * 週 1 通なので、次の通知より長く預かる意味は無い
 */
const TTL_SECONDS = 7 * 24 * 60 * 60;

export type PushSender = (target: PushTarget, message: PushMessage) => Promise<SendOutcome>;

/** `fetch` を差し替えられるようにしてあるのは、テストで push service に出ないため */
export function createPushSender(vapid: VapidKeys, fetchFn: typeof fetch = fetch): PushSender {
  return async (target, message) => {
    try {
      const payload = await buildPushPayload(
        // 同じ週の通知が 2 つ並ばないよう topic で束ねる。値は push service が求める形 (URL-safe、32 字以内)
        { data: message, options: { ttl: TTL_SECONDS, topic: "weekly-digest", urgency: "normal" } },
        {
          endpoint: target.endpoint,
          expirationTime: null,
          keys: { p256dh: target.p256dh, auth: target.auth },
        },
        vapid,
      );
      const response = await fetchFn(target.endpoint, payload);
      if (response.ok) return { kind: "sent" };
      if (response.status === 404 || response.status === 410) {
        return { kind: "expired", status: response.status };
      }
      return { kind: "failed", status: response.status };
    } catch (error) {
      return { kind: "failed", error: error instanceof Error ? error.message : String(error) };
    }
  };
}
