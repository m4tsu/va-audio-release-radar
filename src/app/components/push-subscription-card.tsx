import { Link } from "@tanstack/react-router";
import { useId } from "react";
import { Button } from "@/app/components/ui/button";
import { useT } from "@/app/i18n";
import { usePushStore } from "@/app/store/push-store";

/**
 * 新作のブラウザ通知を購読する区画。フォロー一覧に置く。
 *
 * 状態と操作は `store/push-store.ts` が持ち、ここは状態ごとの文言とボタンを描くだけ。
 * ブラウザから直接サーバーへ送る経路 (store 経由) を持つので、ページではなく部品に置く。
 *
 * `vapidPublicKey` が無い環境 (鍵を置いていない) では区画そのものを出さない。
 * 押しても成立しない操作を見せないため
 */
export function PushSubscriptionCard({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const t = useT();
  const headingId = useId();
  const status = usePushStore((state) => state.status);
  const busy = usePushStore((state) => state.busy);
  const error = usePushStore((state) => state.error);
  const guidance = usePushStore((state) => state.guidance);
  const subscribe = usePushStore((state) => state.subscribe);
  const unsubscribe = usePushStore((state) => state.unsubscribe);

  // idle は SSR とマウント直後。調べ終わるまで出さない (一瞬「対応していません」と見せない)
  if (vapidPublicKey === null || status === "idle") return null;

  return (
    <section aria-labelledby={headingId} className="space-y-3 rounded-xl border bg-card p-4">
      <h2 id={headingId} className="font-medium text-sm">
        {t("push.title")}
      </h2>
      <p className="text-muted-foreground text-sm">{t("push.description")}</p>

      {status === "unsupported" ? (
        <p className="text-sm">
          {t("push.unsupported")}
          {guidance === "ios-add-to-home" ? ` ${t("push.iosGuide")}` : null}
        </p>
      ) : null}

      {status === "denied" ? <p className="text-sm">{t("push.denied")}</p> : null}

      {status === "unsubscribed" ? (
        <Button type="button" disabled={busy} onClick={() => void subscribe(vapidPublicKey)}>
          {busy ? t("push.enabling") : t("push.enable")}
        </Button>
      ) : null}

      {status === "subscribed" ? (
        <div className="flex flex-wrap items-center gap-3">
          <p role="status" className="text-sm">
            {t("push.enabled")}
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void unsubscribe()}
          >
            {busy ? t("push.disabling") : t("push.disable")}
          </Button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {t("push.errorFailed")}
        </p>
      ) : null}

      <p className="text-muted-foreground text-xs">
        {t("push.storageNote")}{" "}
        <Link to="/privacy" className="underline underline-offset-2">
          {t("push.privacyLink")}
        </Link>
      </p>
    </section>
  );
}
