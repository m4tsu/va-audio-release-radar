import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";
import type { ZodError } from "zod";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import { useTurnstile } from "@/app/hooks/use-turnstile";
import { type PlainTKey, type TranslateFn, useT } from "@/app/i18n";
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
 * 何を書く場所なのかは設定の有無に関わらず見えている方がよい
 */

const KIND_LABELS: Record<InquiryKind, PlainTKey> = {
  request: "contact.kindRequest",
  bug: "contact.kindBug",
  other: "contact.kindOther",
};

type SubmitState = { phase: "idle" | "sending" | "accepted" } | { phase: "error"; message: string };

export function InquiryForm({ turnstileSiteKey }: { turnstileSiteKey: string | null }) {
  const t = useT();
  const kindId = useId();
  const bodyId = useId();
  const contactId = useId();
  const contactHintId = useId();

  const [kind, setKind] = useState<InquiryKind>("request");
  const [body, setBody] = useState("");
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
      await submitInquiryFn({ data: { ...parsed.data, turnstileToken: turnstile.token } });
      setBody("");
      setContact("");
      // トークンは 1 回しか使えない。続けて送れるように widget を引き直す
      turnstile.reset();
      setState({ phase: "accepted" });
    } catch (error) {
      setState({ phase: "error", message: failureMessage(error, t) });
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
        />
        <p className="text-muted-foreground text-xs">
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
        {t("contact.storageNote")} {t("contact.turnstileNote")}{" "}
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
 * サーバーが拒んだ理由を画面の言葉にする。
 * 503 (鍵が置かれていない) と 403 (検証を通らなかった) は直し方が違うので分ける
 */
function failureMessage(error: unknown, t: TranslateFn): string {
  switch (statusOf(error)) {
    case 503:
      return t("contact.errorUnavailable");
    case 403:
      return t("contact.errorRejected");
    default:
      return t("contact.errorFailed");
  }
}

/** 投げられたものから HTTP の状態コードを取る。Response のことも、それを包んだ例外のこともある */
function statusOf(error: unknown): number | undefined {
  if (error instanceof Response) return error.status;
  if (typeof error !== "object" || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}
