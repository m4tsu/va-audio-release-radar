import { z } from "zod";
import { INQUIRY_KINDS, LOCALES, STORE_SLUGS } from "../domain/index.ts";
import { httpsUrlSchema } from "./primitives.ts";

/**
 * ブラウザから届く本文 (問い合わせの送信、Web Push の購読、操作の計測) の形。
 * 画面の入力欄とサーバーの検証が同じ上限を読む
 */

// --- 問い合わせの検証 ------------------------------------------------------
// 送信フォームから保存までの境界で検証する。上限を画面とサーバーが共に読むここに置くのは、入力欄の残り文字数と
// サーバーの拒否が別々の値を持つと、画面では書けるのに送れない状態になるため

/**
 * 本文の上限 (文字数)。
 * 上限を置くのは、1 行の大きさを送信側に決めさせないため。
 * 不具合の再現手順を書ききれる桁にしてある
 */
export const INQUIRY_BODY_MAX_LENGTH = 2000;

/** 連絡先の上限 (文字数)。メールアドレスか SNS のアカウント 1 つが入れば足りる */
export const INQUIRY_CONTACT_MAX_LENGTH = 200;

/**
 * 送信された問い合わせの検証。`Inquiry` から表が決める項目 (id と受け取った時刻) を除いた形を作る。
 *
 * 前後の空白を落としてから長さを見るので、空白だけの本文は空として弾く。
 * 連絡先は空文字を undefined に畳む。未記入の欄はブラウザから空文字で届き、
 * そのまま保存すると「未記入」と「空文字」の 2 通りが表に混ざるため
 */
export const inquirySubmissionSchema = z.object({
  kind: z.enum(INQUIRY_KINDS),
  body: z
    .string()
    .trim()
    .min(1, "本文を入力する")
    .max(INQUIRY_BODY_MAX_LENGTH, `本文は ${INQUIRY_BODY_MAX_LENGTH} 文字以内で入力する`),
  contact: z
    .string()
    .trim()
    .max(INQUIRY_CONTACT_MAX_LENGTH, `連絡先は ${INQUIRY_CONTACT_MAX_LENGTH} 文字以内で入力する`)
    .transform((value) => (value.length === 0 ? undefined : value))
    .optional(),
});

/** 検証を通った送信内容 */
export type InquirySubmission = z.infer<typeof inquirySubmissionSchema>;

/**
 * 1 つの購読が追える声優の上限。フォローはブラウザ内で件数を制限していないので、
 * サーバーへ送る側でだけ切る。対象声優の総数よりずっと少なく、1 人が追う数としては十分な値
 */
export const PUSH_SUBSCRIPTION_MAX_ACTORS = 500;

/**
 * ブラウザが払い出す鍵は base64url (詰め物なし)。`PushSubscription.toJSON()` の `keys` がこの形。
 * そのまま DB に入れて送信時にデコードするので、形だけをここで見る
 */
const base64UrlSchema = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[A-Za-z0-9_-]+$/, "base64url で指定する");

/**
 * ブラウザから届く Web Push の購読。`endpoint` が宛先で、`https:` 以外は受け付けない
 * (送信時にそのまま fetch するため)。`voiceActorIds` はブラウザのフォロー中の声優で、
 * 空でもよい (購読してから後でフォローすることがある)
 */
export const pushSubscriptionSchema = z.object({
  endpoint: httpsUrlSchema.pipe(z.string().max(2048)),
  p256dh: base64UrlSchema(200),
  auth: base64UrlSchema(100),
  locale: z.enum(LOCALES),
  voiceActorIds: z.array(z.string().min(1).max(200)).max(PUSH_SUBSCRIPTION_MAX_ACTORS),
});

/** 検証を通った購読 */
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

/** 購読の解除。宛先だけで足りる */
export const pushUnsubscribeSchema = z.object({
  endpoint: httpsUrlSchema.pipe(z.string().max(2048)),
});

// --- 操作の計測 ------------------------------------------------------------

/**
 * 画面から数える操作 (`POST /api/event`)。`docs/product.md` の「製品」の分子になる。
 *
 * 持つのは操作の種類とストアの別だけ。声優 ID やフォローの一覧を足すと、フォローの状態が
 * ブラウザの外に出る (`docs/decisions/0016-count-actions-in-analytics-engine.md`)。
 * 知らない項目が付いた本文は受け付けない (strict)。送る側の誤りで余計な値を保存しないため
 */
export const usageEventSchema = z.discriminatedUnion("type", [
  /** 声優ページでフォローを付けた */
  z.strictObject({ type: z.literal("follow") }),
  /** 作品ページからストアの作品ページへ移るリンクを押した */
  z.strictObject({ type: z.literal("store_click"), store: z.enum(STORE_SLUGS) }),
  /** 作品ページから Audible の無料体験の登録へ移るリンクを押した */
  z.strictObject({ type: z.literal("audible_trial_click") }),
]);

export type UsageEvent = z.infer<typeof usageEventSchema>;
