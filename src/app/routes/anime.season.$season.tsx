import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { EmptyState } from "@/app/components/empty-state";
import { PageHeader } from "@/app/components/page-header";
import { createTranslator, useLocale, useT } from "@/app/i18n";
import { safeHttpsUrl } from "@/app/lib/safe-url";
import { parseSeasonSlug, seasonLabel } from "@/app/lib/season";
import type { AnimeSummary } from "@/app/lib/view-types";
import { fetchSeasonAnime } from "@/app/server-fns/anime";
import { siteOriginForLoader } from "@/app/server-fns/site";

/**
 * シーズンのアニメ一覧 (設計 `docs/feature-proposals/anime-season-entry-design-2026-09-18.md`)。
 *
 * 声優名を知らない利用者がアニメから入ってくる経路。放送中のアニメは毎クール入れ替わるので、
 * back catalog 中心の他のページに無い「時期性」をここが受け持つ
 */
export const Route = createFileRoute("/anime/season/$season")({
  loader: async ({ params }) => {
    const parsed = parseSeasonSlug(params.season);
    if (!parsed) throw notFound();

    const [anime, origin] = await Promise.all([
      fetchSeasonAnime({ data: parsed }),
      siteOriginForLoader(),
    ]);

    return { anime, origin, ...parsed };
  },
  head: ({ loaderData, params, match }) => {
    if (!loaderData) return {};

    const locale = match.context.locale;
    const t = createTranslator(locale);
    const season = seasonLabel(loaderData.seasonYear, loaderData.season, locale);
    const title = t("anime.seasonMetaTitle", { season });
    const description = t("anime.seasonMetaDescription", { season });
    const canonical = absoluteUrl(loaderData.origin, `/anime/season/${params.season}`);

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
  component: SeasonPage,
});

function absoluteUrl(origin: string | undefined, path: string): string {
  return origin ? `${origin}${path}` : path;
}

function SeasonPage() {
  const t = useT();
  const locale = useLocale();
  const { anime, seasonYear, season } = Route.useLoaderData();
  const label = seasonLabel(seasonYear, season, locale);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("anime.seasonTitle", { season: label })}
        description={t("anime.seasonDescription")}
      />

      {anime.length === 0 ? (
        <EmptyState
          title={t("anime.seasonEmptyTitle")}
          description={t("anime.seasonEmptyDescription", { season: label })}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {anime.map((item) => (
            <AnimeCard key={item.slug} anime={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function AnimeCard({ anime }: { anime: AnimeSummary }) {
  const t = useT();
  const cover = safeHttpsUrl(anime.coverImageUrl);

  return (
    <Link
      to="/anime/$slug"
      params={{ slug: anime.slug }}
      className="flex gap-3 rounded-xl border p-3 transition-colors hover:bg-accent"
    >
      {cover ? (
        <img
          src={cover}
          alt=""
          className="h-24 w-16 shrink-0 rounded-md object-cover"
          loading="lazy"
        />
      ) : null}
      <div className="min-w-0 space-y-1">
        <p className="font-medium leading-snug">{anime.titleNative}</p>
        <p className="text-muted-foreground text-xs">
          {t("anime.actorCount", { count: anime.actorCount })}
        </p>
      </div>
    </Link>
  );
}
