import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { inquirySubmissionSchema } from "@/contract";

/**
 * お問い合わせ画面 (`/contact`) の server function。
 *
 * 送信は誰でも叩ける経路なので、bot 対策 (Cloudflare Turnstile) の検証を必ず通す。
 * 画面側の鍵 `TURNSTILE_SITE_KEY` と検証側の鍵 `TURNSTILE_SECRET_KEY` の
 * どちらかが欠けていれば送信は成立しない (`@/server/turnstile`)
 */

/** 画面に渡す設定。`turnstileSiteKey` が null なら送信できない */
export type InquiryFormConfig = { turnstileSiteKey: string | null };

/** 受け付けなかった理由。画面はこれで文言を選ぶ */
export type InquiryRejection =
  /** `TURNSTILE_SECRET_KEY` がサーバーに無い */
  | "unconfigured"
  /** bot 対策の検証を通らなかった (トークンが古い、使い回された、など) */
  | "rejected";

export type InquirySubmitResult =
  | { accepted: true }
  | { accepted: false; reason: InquiryRejection };

/**
 * 両方の鍵が揃ったときだけ site key を返す。
 * 片方だけでは送信がサーバーで落ちるので、画面からは同じ「使えない」に見せる
 */
export const fetchInquiryFormConfig = createServerFn({ method: "GET" }).handler(
  async (): Promise<InquiryFormConfig> => {
    const { env } = await import("cloudflare:workers");
    const siteKey = env.TURNSTILE_SITE_KEY?.trim() ?? "";
    const secret = env.TURNSTILE_SECRET_KEY?.trim() ?? "";
    return { turnstileSiteKey: siteKey && secret ? siteKey : null };
  },
);

/**
 * 送信された問い合わせを保存する。
 *
 * 検証の順は「入力の形 → bot 対策 → 保存」。入力の形は `inquirySubmissionSchema` が
 * validator で見るので、ここに書き足さない。
 *
 * 受け付けなかったときは応答の状態コードも分ける (鍵の未設定 503 / 検証の失敗 403)。
 * 管理 API (`@/server/auth`) と同じ扱いで、運用時に「鍵を置き忘れている」のか
 * 「bot 対策で弾いた」のかを切り分けるため。
 * **状態コードだけに載せない。** server function を呼んだ側には本体の値しか届かないので、
 * 理由は戻り値にも入れる
 */
export const submitInquiryFn = createServerFn({ method: "POST" })
  .validator(inquirySubmissionSchema.extend({ turnstileToken: z.string() }))
  .handler(async ({ data }): Promise<InquirySubmitResult> => {
    const { turnstileToken, ...submission } = data;

    const [{ getRequest, setResponseStatus }, { env }, { verifyTurnstile }] = await Promise.all([
      import("@tanstack/react-start/server"),
      import("cloudflare:workers"),
      import("@/server/turnstile"),
    ]);

    const secret = env.TURNSTILE_SECRET_KEY?.trim();
    if (!secret) {
      setResponseStatus(503);
      return { accepted: false, reason: "unconfigured" };
    }

    const request = getRequest();
    const verified = await verifyTurnstile(
      turnstileToken,
      secret,
      // Cloudflare が付ける接続元。ローカルでは無いので undefined になる
      request.headers.get("cf-connecting-ip") ?? undefined,
    );
    if (!verified.ok) {
      // 鍵の取り違え (invalid-input-secret) と bot の弾き分けは、運用ではログでしか見えない。
      // 画面には出さない (送信者に検証の内部事情を教えても直せない)
      console.error("turnstile の検証を通らなかった", verified.errorCodes);
      setResponseStatus(403);
      return { accepted: false, reason: "rejected" };
    }

    const [{ getDb }, { saveInquiry }] = await Promise.all([
      import("@/server/db/client"),
      import("@/server/queries/inquiries"),
    ]);
    await saveInquiry(getDb(), submission);
    return { accepted: true };
  });
