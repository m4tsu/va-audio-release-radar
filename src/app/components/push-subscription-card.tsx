import { Link } from "@tanstack/react-router";
import { useId } from "react";
import { HelpPopover } from "@/app/components/help-popover";
import { Button } from "@/app/components/ui/button";
import { useT } from "@/app/i18n";
import { usePushStore } from "@/app/store/push-store";

/**
 * 新作のブラウザ通知を購読する区画。フォロー中ページの見出しの操作の位置に置く。
 * 枠付きの区画として見出しの下に置くと、狭い画面では全幅を取って作品の一覧を押し下げる。
 *
 * 状態と操作は `store/push-store.ts` が持ち、ここは状態ごとの文言とボタンを描くだけ。
 * ブラウザから直接サーバーへ送る経路 (store 経由) を持つので、ページではなく部品に置く。
 *
 * `vapidPublicKey` が無い環境 (鍵を置いていない) では区画そのものを出さない。
 * 押しても成立しない操作を見せないため。
 *
 * 常に出すのは状態と操作と、操作に要る案内 (非対応・ブロック・エラー) だけ。
 * 何をする通知か、サーバーに何を保存するかは見出しの隣のヘルプの印に入れる
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
    <section aria-labelledby={headingId} className="max-w-sm space-y-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-1">
          <h2 id={headingId} className="font-medium text-sm">
            {t("push.title")}
          </h2>
          <PushHelp />
        </div>

        {status === "unsubscribed" ? (
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => void subscribe(vapidPublicKey)}
          >
            {busy ? t("push.enabling") : t("push.enable")}
          </Button>
        ) : null}

        {status === "subscribed" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void unsubscribe()}
          >
            {busy ? t("push.disabling") : t("push.disable")}
          </Button>
        ) : null}
      </div>

      {status === "subscribed" ? (
        <p role="status" className="text-muted-foreground text-xs">
          {t("push.enabled")}
        </p>
      ) : null}

      {status === "unsupported" ? (
        <p className="text-muted-foreground text-xs">
          {t("push.unsupported")}
          {guidance === "ios-add-to-home" ? ` ${t("push.iosGuide")}` : null}
        </p>
      ) : null}

      {status === "denied" ? (
        <p className="text-muted-foreground text-xs">{t("push.denied")}</p>
      ) : null}

      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {t("push.errorFailed")}
        </p>
      ) : null}
    </section>
  );
}

/** 何をする通知か、購読すると何がサーバーに渡るか。購読の操作を置く場所ではどこでも添える */
export function PushHelp() {
  const t = useT();
  return (
    <HelpPopover label={t("push.helpLabel")}>
      <p>{t("push.description")}</p>
      <p className="text-muted-foreground text-xs">
        {t("push.storageNote")}{" "}
        <Link to="/privacy" className="underline underline-offset-2">
          {t("push.privacyLink")}
        </Link>
      </p>
    </HelpPopover>
  );
}
