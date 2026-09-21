import { Link } from "@tanstack/react-router";
import { EmptyState } from "@/app/components/empty-state";
import { FollowFeed } from "@/app/components/follow-feed";
import { FollowManager } from "@/app/components/follow-manager";
import { FollowedAnime } from "@/app/components/followed-anime";
import { PageHeader } from "@/app/components/page-header";
import { PushSubscriptionCard } from "@/app/components/push-subscription-card";
import { Button } from "@/app/components/ui/button";
import { useT } from "@/app/i18n";
import { useFollowStore } from "@/app/store/follow-store";

/**
 * フォロー中の声優の音声作品。
 *
 * このページの主役は作品で、フォローしている声優の一覧はその材料。誰をフォローしているかと
 * 解除の導線を作品の上に置くのはそのため。フォローはブラウザ内 (IndexedDB) にしか無いので、
 * SSR では枠だけを返し、中身はマウント後に描く。読み込み前を「0 件」と見せないよう status で分ける。
 * 出演アニメを作品の後ろに置くのは、フォローした人を思い出す手がかりであって主役ではないため。
 *
 * 新作の通知の区画はフォローが 0 件でも出す。先に購読しておいて後からフォローする順でも成立する
 */
export function FollowingPage({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const t = useT();
  const follows = useFollowStore((state) => state.follows);
  const status = useFollowStore((state) => state.status);

  return (
    <div>
      <PageHeader title={t("following.title")} />

      {status !== "ready" ? (
        <p className="text-muted-foreground text-sm">{t("common.loading")}</p>
      ) : null}

      {status === "ready" ? (
        <div className="space-y-8">
          <PushSubscriptionCard vapidPublicKey={vapidPublicKey} />

          {follows.length === 0 ? (
            <EmptyState
              title={t("following.emptyTitle")}
              action={
                <Button asChild>
                  <Link to="/voice-actors">{t("following.emptyAction")}</Link>
                </Button>
              }
            />
          ) : (
            <>
              <FollowManager />
              <FollowFeed />
              <FollowedAnime />
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
