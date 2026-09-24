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
  /**
   * 送れなかった。`permanent` が true なら、この購読にこの週は何度送っても通らない
   * (鍵の不一致や本文の拒否など push service が 4xx で答えたもの)。false なら一時的な失敗で、
   * 次の起動で送り直す (5xx、429、通信の失敗)
   */
  | { kind: "failed"; permanent: boolean; status?: number; error?: string };

/**
 * 通知が届くまでに push service が預かる時間。ブラウザが閉じていても 1 週間以内に開けば届く。
 * 週 1 通なので、次の通知より長く預かる意味は無い
 */
const TTL_SECONDS = 7 * 24 * 60 * 60;

/** 失敗時に残す応答本文の上限 (文字数) */
const ERROR_BODY_LIMIT = 300;

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
      // 429 は混雑。それ以外の 4xx は要求そのものが拒まれたので、送り直しても通らない
      const permanent = response.status >= 400 && response.status < 500 && response.status !== 429;
      // 拒んだ理由は本文にしか無い (Apple は {"reason": ...} を返す)。ログに収まる長さで切る
      const reason = (await response.text().catch(() => "")).slice(0, ERROR_BODY_LIMIT);
      return reason
        ? { kind: "failed", permanent, status: response.status, error: reason }
        : { kind: "failed", permanent, status: response.status };
    } catch (error) {
      return {
        kind: "failed",
        permanent: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
}
