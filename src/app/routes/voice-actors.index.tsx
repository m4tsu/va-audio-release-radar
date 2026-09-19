import { createFileRoute, Link } from "@tanstack/react-router";
import { ActorSearch } from "@/app/components/actor-search";
import { EmptyState } from "@/app/components/empty-state";
import { PageHeader } from "@/app/components/page-header";
import { Badge } from "@/app/components/ui/badge";
import { createTranslator, useLocale, useT } from "@/app/i18n";
import { actorDisplayName } from "@/app/lib/actor-name";
import type { ActorSummary } from "@/app/lib/view-types";
import { fetchAllActors } from "@/app/server-fns/actors";
import { siteOriginForLoader } from "@/app/server-fns/site";

/**
 * 声優の一覧。名前を知らない・思い出せない人がここから声優ページへ入る。
 *
 * 出るのは音声作品が 1 件以上ある声優だけ (`listActors`)。中身は全部 SSR で出して
 * インデックスさせる。声優ページへの内部リンクをまとめて置ける唯一のページでもある
 */
export const Route = createFileRoute("/voice-actors/")({
  loader: async () => {
    const [actors, origin] = await Promise.all([fetchAllActors(), siteOriginForLoader()]);
    return { actors, origin };
  },
  head: ({ loaderData, match }) => {
    const t = createTranslator(match.context.locale);
    const title = t("voiceActors.metaTitle", { app: t("app.name") });
    const description = t("voiceActors.metaDescription");
    const canonical = loaderData?.origin ? `${loaderData.origin}/voice-actors` : "/voice-actors";

    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:url", content: canonical },
      ],
      links: [{ rel: "canonical", href: canonical }],
    };
  },
  component: VoiceActorsPage,
});

function VoiceActorsPage() {
  const t = useT();
  const { actors } = Route.useLoaderData();

  return (
    <div className="space-y-8">
      <PageHeader title={t("voiceActors.title")} />
      <ActorSearch />
      {actors.length === 0 ? (
        <EmptyState title={t("voiceActors.emptyTitle")} />
      ) : (
        <ActorDirectory actors={actors} />
      )}
    </div>
  );
}

function ActorDirectory({ actors }: { actors: ActorSummary[] }) {
  const t = useT();
  const locale = useLocale();

  return (
    <ul aria-label={t("voiceActors.title")} className="flex flex-wrap gap-2">
      {actors.map((actor) => (
        <li key={actor.id}>
          <Link
            to="/voice-actors/$slug"
            params={{ slug: actor.slug }}
            className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
          >
            {actorDisplayName(actor, locale)}
            <Badge variant="secondary">{actor.workCount}</Badge>
          </Link>
        </li>
      ))}
    </ul>
  );
}
