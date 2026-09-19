import { createFileRoute, Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { EmptyState } from "@/app/components/empty-state";
import { FollowFeed } from "@/app/components/follow-feed";
import { PageHeader } from "@/app/components/page-header";
import { Button } from "@/app/components/ui/button";
import { createTranslator, useLocale, useT } from "@/app/i18n";
import { actorDisplayName } from "@/app/lib/actor-name";
import { useFollowStore } from "@/app/store/follow-store";

/**
 * フォロー中の声優の音声作品。
 *
 * このページの主役は作品で、フォローしている声優の一覧はその材料。誰をフォローしているかと
 * 解除の導線を作品の上に置くのはそのため。フォローはブラウザ内 (IndexedDB) にしか無いので、
 * SSR では枠だけを返し、中身はマウント後に描く。読み込み前を「0 件」と見せないよう status で分ける
 */
export const Route = createFileRoute("/following")({
  head: ({ match }) => {
    const t = createTranslator(match.context.locale);
    return {
      meta: [
        { title: t("following.metaTitle", { app: t("app.name") }) },
        // フォローはブラウザごとに違う。検索結果に出しても意味が無い
        { name: "robots", content: "noindex" },
      ],
    };
  },
  component: FollowingPage,
});

function FollowingPage() {
  const t = useT();
  const follows = useFollowStore((state) => state.follows);
  const status = useFollowStore((state) => state.status);

  return (
    <div>
      <PageHeader title={t("following.title")} />

      {status !== "ready" ? (
        <p className="text-muted-foreground text-sm">{t("common.loading")}</p>
      ) : null}

      {status === "ready" && follows.length === 0 ? (
        <EmptyState
          title={t("following.emptyTitle")}
          action={
            <Button asChild>
              <Link to="/voice-actors">{t("following.emptyAction")}</Link>
            </Button>
          }
        />
      ) : null}

      {status === "ready" && follows.length > 0 ? (
        <div className="space-y-8">
          <FollowManager />
          <FollowFeed />
        </div>
      ) : null}
    </div>
  );
}

/**
 * フォローの管理。作品一覧の前置きなので、名前と解除だけを横に詰めて置く。
 * 声優ページへ行かなくてもここから解除できることが、このページを「一覧」にしている条件
 */
function FollowManager() {
  const t = useT();
  const locale = useLocale();
  const follows = useFollowStore((state) => state.follows);
  const unfollow = useFollowStore((state) => state.unfollow);

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="font-medium text-sm">
        {t("following.manageTitle", { count: follows.length })}
      </h2>
      <ul aria-label={t("following.listLabel")} className="flex flex-wrap gap-2">
        {follows.map((actor) => {
          const name = actorDisplayName(actor, locale);
          return (
            <li
              key={actor.voiceActorId}
              className="inline-flex items-center gap-1 rounded-full border bg-background py-1 pr-1 pl-3 text-sm"
            >
              <Link
                to="/voice-actors/$slug"
                params={{ slug: actor.slug }}
                className="hover:underline"
              >
                {name}
              </Link>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t("follow.unfollowActor", { name })}
                className="rounded-full"
                onClick={() => void unfollow(actor.voiceActorId)}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          );
        })}
      </ul>
      <p className="text-muted-foreground text-xs">{t("following.storageNote")}</p>
    </section>
  );
}
