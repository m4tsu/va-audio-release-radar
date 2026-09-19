import { createFileRoute, Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { EmptyState } from "@/app/components/empty-state";
import { PageHeader } from "@/app/components/page-header";
import { Button } from "@/app/components/ui/button";
import { createTranslator, useLocale, useT } from "@/app/i18n";
import { actorDisplayName } from "@/app/lib/actor-name";
import { useFollowStore } from "@/app/store/follow-store";

/**
 * フォロー中の声優一覧 (企画書 §13)。
 *
 * フォローはブラウザ内 (IndexedDB) にしか無いので、SSR では枠だけを返し、
 * 中身はマウント後に描く。読み込み前を「0 件」と見せないよう status で分ける
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
  const locale = useLocale();
  const follows = useFollowStore((state) => state.follows);
  const status = useFollowStore((state) => state.status);
  const unfollow = useFollowStore((state) => state.unfollow);

  return (
    <div>
      <PageHeader title={t("following.title")} description={t("following.description")} />

      {status !== "ready" ? (
        <p className="text-muted-foreground text-sm">{t("common.loading")}</p>
      ) : null}

      {status === "ready" && follows.length === 0 ? (
        <EmptyState
          title={t("following.emptyTitle")}
          description={t("following.emptyDescription")}
          action={
            <Button asChild>
              <Link to="/">{t("following.emptyAction")}</Link>
            </Button>
          }
        />
      ) : null}

      {status === "ready" && follows.length > 0 ? (
        <ul aria-label={t("following.listLabel")} className="divide-y rounded-xl border bg-card">
          {follows.map((actor) => (
            <li
              key={actor.voiceActorId}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <Link
                to="/voice-actors/$slug"
                params={{ slug: actor.slug }}
                className="min-w-0 font-medium hover:underline"
              >
                {actorDisplayName(actor, locale)}
              </Link>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void unfollow(actor.voiceActorId)}
              >
                <X aria-hidden="true" />
                {t("follow.unfollow")}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
