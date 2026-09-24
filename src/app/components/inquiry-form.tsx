import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";
import type { ZodError } from "zod";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import { useTurnstile } from "@/app/hooks/use-turnstile";
import { type PlainTKey, type TranslateFn, useT } from "@/app/i18n";
import { DEFAULT_INQUIRY_KIND } from "@/app/lib/contact-search";
import type { InquiryRejection } from "@/app/server-fns/inquiries";
import { submitInquiryFn } from "@/app/server-fns/inquiries";
import {
  INQUIRY_BODY_MAX_LENGTH,
  INQUIRY_CONTACT_MAX_LENGTH,
  INQUIRY_KINDS,
  type InquiryKind,
  inquirySubmissionSchema,
} from "@/domain/types";

/**
 * お問い合わせの入力と送信。
 *
 * ブラウザから直接 server function を呼ぶのでページではなく部品に置く
 * (ページはデータを props で受け取るだけで、サーバーを呼ばない)。
 *
 * 入力の可否は `inquirySubmissionSchema` が決める。画面は結果を訳すだけで、
 * 独自の条件を足さない (足すと画面では書けるのに送れない状態が生まれる)。
 * `turnstileSiteKey` が null のときも入力欄は描く。送信できないことは伝えつつ、
 * 何を書く場所なのかは設定の有無に関わらず見えている方がよい。
 *
 * 種別と本文の初期値は外から受ける。作品ページ・声優ページの「掲載内容の誤りを知らせる」から
 * 開いたときに、対象のページを申し出る人が書き写さずに済ませるため
 */

const KIND_LABELS: Record<InquiryKind, PlainTKey> = {
  request: "contact.kindRequest",
  bug: "contact.kindBug",
  correction: "contact.kindCorrection",
  other: "contact.kindOther",
};

type SubmitState = { phase: "idle" | "sending" | "accepted" } | { phase: "error"; message: string };

export function InquiryForm({
  turnstileSiteKey,
  defaultKind = DEFAULT_INQUIRY_KIND,
  targetUrl = null,
}: {
  turnstileSiteKey: string | null;
  /** 最初に選ばれている種別 */
  defaultKind?: InquiryKind;
  /** 申し出の対象のページ。本文の先頭に置く。無ければ本文は空で始まる */
  targetUrl?: string | null;
}) {
  const t = useT();
  const kindId = useId();
  const bodyId = useId();
  const bodyHintId = useId();
  const contactId = useId();
  const contactHintId = useId();

  // 対象の URL は本文の「先頭」に入れる。書き足す場所を空けたいので後ろに空行を 1 つ置く
  const initialBody = targetUrl === null ? "" : `${targetUrl}\n\n`;

  const [kind, setKind] = useState<InquiryKind>(defaultKind);
  const [body, setBody] = useState(initialBody);
  const [contact, setContact] = useState("");
  const [state, setState] = useState<SubmitState>({ phase: "idle" });

  const turnstile = useTurnstile(turnstileSiteKey);
  const sendable = turnstileSiteKey !== null;

  const submit = async () => {
    const parsed = inquirySubmissionSchema.safeParse({ kind, body, contact });
    if (!parsed.success) {
      setState({ phase: "error", message: invalidInputMessage(parsed.error, t) });
      return;
    }
    if (turnstile.token === null) {
      setState({ phase: "error", message: t("contact.errorPending") });
      return;
    }

    setState({ phase: "sending" });
    try {
      const result = await submitInquiryFn({
        data: { ...parsed.data, turnstileToken: turnstile.token },
      });
      // トークンは 1 回しか使えない。受け付けられても弾かれても、次の送信には新しい組が要る
      turnstile.reset();
      if (!result.accepted) {
        setState({ phase: "error", message: rejectionMessage(result.reason, t) });
        return;
      }
      // 同じページについてもう 1 通送れるよう、開いたときの状態に戻す
      setKind(defaultKind);
      setBody(initialBody);
      setContact("");
      setState({ phase: "accepted" });
    } catch (error) {
      // 通信そのものが失敗したとき。理由は利用者に出せる形ではないので畳む
      void error;
      turnstile.reset();
      setState({ phase: "error", message: t("contact.errorFailed") });
    }
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="space-y-1">
        <Label htmlFor={kindId}>{t("contact.kindLabel")}</Label>
        <select
          id={kindId}
          value={kind}
          onChange={(event) => setKind(event.target.value as InquiryKind)}
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:w-60"
        >
          {INQUIRY_KINDS.map((value) => (
            <option key={value} value={value}>
              {t(KIND_LABELS[value])}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <Label htmlFor={bodyId}>{t("contact.bodyLabel")}</Label>
        <Textarea
          id={bodyId}
          value={body}
          rows={8}
          onChange={(event) => setBody(event.target.value)}
          aria-describedby={bodyHintId}
        />
        <p id={bodyHintId} className="text-muted-foreground text-xs">
          {t("contact.bodyHint", { max: INQUIRY_BODY_MAX_LENGTH })}
        </p>
      </div>

      <div className="space-y-1">
        <Label htmlFor={contactId}>{t("contact.contactLabel")}</Label>
        <Input
          id={contactId}
          value={contact}
          onChange={(event) => setContact(event.target.value)}
          autoComplete="off"
          aria-describedby={contactHintId}
        />
        <p id={contactHintId} className="text-muted-foreground text-xs">
          {t("contact.contactHint")}
        </p>
      </div>

      {/* Cloudflare の widget が描かれる場所。site key が無ければ何も読み込まない */}
      {turnstileSiteKey === null ? null : <div ref={turnstile.containerRef} />}

      <p className="text-muted-foreground text-xs">
        {t("contact.storageNote")}{" "}
        <Link to="/privacy" className="underline underline-offset-2">
          {t("contact.privacyLink")}
        </Link>
      </p>

      <Button type="submit" disabled={!sendable || state.phase === "sending"}>
        {state.phase === "sending" ? t("contact.submitting") : t("contact.submit")}
      </Button>

      {state.phase === "accepted" ? (
        <p role="status" className="text-sm">
          {t("contact.accepted")}
        </p>
      ) : null}
      {state.phase === "error" ? (
        <p role="alert" className="text-destructive text-sm">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

/**
 * 検証に落ちた理由を画面の言葉にする。
 * zod のメッセージは日本語で書かれているので、そのまま出すと英語表示で混ざる
 */
function invalidInputMessage(error: ZodError, t: TranslateFn): string {
  const issue = error.issues[0];
  if (issue?.path[0] === "contact") {
    return t("contact.errorContactTooLong", { max: INQUIRY_CONTACT_MAX_LENGTH });
  }
  if (issue?.code === "too_big") {
    return t("contact.errorBodyTooLong", { max: INQUIRY_BODY_MAX_LENGTH });
  }
  return t("contact.errorBodyEmpty");
}

/**
 * サーバーが受け付けなかった理由を画面の言葉にする。
 * 鍵が置かれていないのと検証を通らなかったのでは、利用者が次にできることが違う
 */
function rejectionMessage(reason: InquiryRejection, t: TranslateFn): string {
  return reason === "unconfigured" ? t("contact.errorUnavailable") : t("contact.errorRejected");
}
