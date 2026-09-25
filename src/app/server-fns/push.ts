import { createServerFn } from "@tanstack/react-start";
import { pushSubscriptionSchema, pushUnsubscribeSchema } from "@/contract";

/**
 * Web Push の購読の server function。フォロー一覧 (`/following`) の通知の区画が呼ぶ。
 *
 * 認可は無い。購読はブラウザが push service から受け取った宛先で、他人のものを知る手段が無く、
 * 偽の宛先を送られても送信で失効 (404 / 410) が返って消える。受け取る形は Zod で絞り、
 * 追う声優の数にも上限を置く (`pushSubscriptionSchema`)
 */

/** 画面に渡す設定。`vapidPublicKey` が null なら通知の案内を出さない */
export type PushConfig = { vapidPublicKey: string | null };

export const fetchPushConfig = createServerFn({ method: "GET" }).handler(
  async (): Promise<PushConfig> => {
    const { env } = await import("cloudflare:workers");
    const key = env.VAPID_PUBLIC_KEY?.trim() ?? "";
    return { vapidPublicKey: key.length > 0 ? key : null };
  },
);

/**
 * 購読を保存する。同じ endpoint なら鍵・言語・追う声優を置き換える。
 * 戻り値の `voiceActorIds` は実際に保存された声優 (知らない ID は落ちる)
 */
export const savePushSubscriptionFn = createServerFn({ method: "POST" })
  .validator(pushSubscriptionSchema)
  .handler(async ({ data }): Promise<{ voiceActorIds: string[] }> => {
    const [{ getDb }, { savePushSubscription }] = await Promise.all([
      import("@/server/db/client"),
      import("@/server/queries/push-subscriptions"),
    ]);
    const saved = await savePushSubscription(getDb(), data);
    return { voiceActorIds: saved.voiceActorIds };
  });

/** 購読を消す。既に無くても成功として返す (ブラウザ側は解除を続けてよい) */
export const deletePushSubscriptionFn = createServerFn({ method: "POST" })
  .validator(pushUnsubscribeSchema)
  .handler(async ({ data }): Promise<{ deleted: boolean }> => {
    const [{ getDb }, { deletePushSubscription }] = await Promise.all([
      import("@/server/db/client"),
      import("@/server/queries/push-subscriptions"),
    ]);
    return { deleted: await deletePushSubscription(getDb(), data.endpoint) };
  });
