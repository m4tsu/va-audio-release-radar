import { useState } from "react";
import { PushHelp } from "@/app/components/push-subscription-card";
import { Button } from "@/app/components/ui/button";
import { useT } from "@/app/i18n";
import { usePushStore } from "@/app/store/push-store";

/**
 * フォローした直後に出す、新作の通知の案内。通知の設定はフォロー中ページにしか無く、
 * 声優ページからフォローした人はそこへ行かないと通知があることに気づけない。
 *
 * 出すのは、出した時点でこのブラウザが未購読のときだけ。購読済み・非対応・ブロック中の人には
 * 打てる手が無いか既に済んでいるので、フォローのたびに何かを言わない。
 * 一度出した後は購読の結果 (設定済み・ブロック・失敗) をここで返す。消すと押した結果が見えない
 */
export function PushFollowPrompt({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const t = useT();
  // 出すかどうかは出した時点の状態で決める。購読して status が変わっても案内は消さない
  const [offered] = useState(() => usePushStore.getState().status === "unsubscribed");
  const status = usePushStore((state) => state.status);
  const busy = usePushStore((state) => state.busy);
  const error = usePushStore((state) => state.error);
  const subscribe = usePushStore((state) => state.subscribe);

  if (vapidPublicKey === null || !offered) return null;

  return (
    <div className="space-y-2 rounded-xl border bg-card p-3 text-sm">
      {status === "unsubscribed" ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="flex items-center gap-1">
            {t("push.afterFollow")}
            <PushHelp />
          </p>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => void subscribe(vapidPublicKey)}
          >
            {busy ? t("push.enabling") : t("push.enable")}
          </Button>
        </div>
      ) : null}

      {status === "subscribed" ? <p role="status">{t("push.enabled")}</p> : null}
      {status === "denied" ? <p>{t("push.denied")}</p> : null}

      {error ? (
        <p role="alert" className="text-destructive">
          {t("push.errorFailed")}
        </p>
      ) : null}
    </div>
  );
}
