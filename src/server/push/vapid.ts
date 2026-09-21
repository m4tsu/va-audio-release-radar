import type { VapidKeys } from "@block65/webcrypto-web-push";

/**
 * 送信に要る 3 つの設定。公開鍵は `wrangler.jsonc` の `vars`、秘密鍵は wrangler secret、
 * subject は push service に名乗る連絡先 (`mailto:` か `https:` の URL) で `vars`。
 * どれか 1 つでも欠けていれば送らない (`digest.ts` の `runDigest` は null を「送らない」と読む)
 */
export function vapidFromEnv(env: {
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}): VapidKeys | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() ?? "";
  const subject = env.VAPID_SUBJECT?.trim() ?? "";
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}
