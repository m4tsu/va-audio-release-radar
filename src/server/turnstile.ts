/**
 * bot 対策 (Cloudflare Turnstile) の検証。
 *
 * 秘匿値とトークンは呼び出し側から渡してもらい、このファイルは `cloudflare:workers` に
 * 依存しない (単体テストから素の値で呼べるようにする)。`@/server/auth` と同じ形。
 *
 * 画面側の鍵は `TURNSTILE_SITE_KEY` (HTML に出るので wrangler.jsonc の `vars`)、
 * 検証側の鍵は `TURNSTILE_SECRET_KEY` (wrangler secret)。どちらかが欠けると送信は通らない
 */

/** Cloudflare の検証エンドポイント。Worker からの外部アクセスはここだけ */
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** 失敗の理由は Cloudflare が返す識別子をそのまま持つ。画面には出さず、運用で読むためのもの */
export type TurnstileResult = { ok: true } | { ok: false; errorCodes: string[] };

/**
 * トークンを Cloudflare に問い合わせて確かめる。
 *
 * トークンは 1 回しか使えない。同じトークンで 2 度目を検証すると失敗するので、
 * 送信のたびに画面側で widget を引き直す。
 * `remoteIp` は任意。渡すと Cloudflare 側の判定材料が増える
 */
export async function verifyTurnstile(
  token: string,
  secret: string,
  remoteIp?: string,
): Promise<TurnstileResult> {
  // 空のトークンは Cloudflare に投げるまでもなく失敗する。外への往復を 1 回節約する
  if (token.length === 0) return { ok: false, errorCodes: ["missing-input-response"] };

  const form = new FormData();
  form.set("secret", secret);
  form.set("response", token);
  if (remoteIp) form.set("remoteip", remoteIp);

  const response = await fetch(SITEVERIFY_URL, { method: "POST", body: form });
  // Cloudflare 側が落ちているときに「検証を通った」とは扱わない
  if (!response.ok) return { ok: false, errorCodes: [`http-${response.status}`] };

  const body = (await response.json()) as { success?: boolean; "error-codes"?: string[] };
  if (body.success === true) return { ok: true };
  return { ok: false, errorCodes: body["error-codes"] ?? [] };
}
