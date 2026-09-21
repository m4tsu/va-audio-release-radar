import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { inquirySubmissionSchema } from "@/domain/types";

/**
 * お問い合わせ画面 (`/contact`) の server function。
 *
 * 送信は誰でも叩ける経路なので、bot 対策 (Cloudflare Turnstile) の検証を必ず通す。
 * 画面側の鍵 `TURNSTILE_SITE_KEY` と検証側の鍵 `TURNSTILE_SECRET_KEY` の
 * どちらかが欠けていれば送信は成立しない (`@/server/turnstile`)
 */

/** 画面に渡す設定。`turnstileSiteKey` が null なら送信できない */
export type InquiryFormConfig = { turnstileSiteKey: string | null };

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
 * 応答は設定漏れ (503) と検証失敗 (403) を分ける。管理 API (`@/server/auth`) と同じ扱いで、
 * 運用時に「鍵を置き忘れている」のか「bot 対策で弾いた」のかを切り分けるため
 */
export const submitInquiryFn = createServerFn({ method: "POST" })
  .validator(inquirySubmissionSchema.extend({ turnstileToken: z.string() }))
  .handler(async ({ data }) => {
    const { turnstileToken, ...submission } = data;

    const [{ getRequest }, { env }, { verifyTurnstile }] = await Promise.all([
      import("@tanstack/react-start/server"),
      import("cloudflare:workers"),
      import("@/server/turnstile"),
    ]);

    const secret = env.TURNSTILE_SECRET_KEY?.trim();
    if (!secret) {
      throw new Response("bot 対策の鍵がサーバーに設定されていない", { status: 503 });
    }

    const request = getRequest();
    const verified = await verifyTurnstile(
      turnstileToken,
      secret,
      // Cloudflare が付ける接続元。ローカルでは無いので undefined になる
      request.headers.get("cf-connecting-ip") ?? undefined,
    );
    if (!verified.ok) {
      throw new Response("bot 対策の検証を通らなかった", { status: 403 });
    }

    const [{ getDb }, { saveInquiry }] = await Promise.all([
      import("@/server/db/client"),
      import("@/server/queries/inquiries"),
    ]);
    await saveInquiry(getDb(), submission);
  });
