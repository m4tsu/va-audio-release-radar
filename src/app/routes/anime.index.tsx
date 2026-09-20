import { createFileRoute } from "@tanstack/react-router";
import { createTranslator } from "@/app/i18n";
import { featuredSeason } from "@/app/lib/season";
import { AnimeIndexPage } from "@/app/pages/anime-index";
import { fetchAnimeSeasons, fetchSeasonAnime } from "@/app/server-fns/anime";
import { siteOriginForLoader } from "@/app/server-fns/site";

/** 先頭に出す放送中シーズンの件数。続きは「このシーズンをすべて見る」から */
const FEATURED_LIMIT = 6;

/** アニメ導線の入口。放送中シーズンの抜粋・アニメ名の検索・シーズンの索引。画面は `@/app/pages/anime-index` */
export const Route = createFileRoute("/anime/")({
  loader: async () => {
    const [seasons, origin] = await Promise.all([fetchAnimeSeasons(), siteOriginForLoader()]);

    // シーズンの索引を先に引く。どのシーズンに作品があるかが分からないと、放送中のシーズンを
    // 出せないときの行き先 (古い方向でいちばん新しいシーズン) が決まらない。索引はたかだか数十行
    const key = featuredSeason(seasons, new Date());
    if (!key) return { seasons, origin, featured: null };

    const anime = await fetchSeasonAnime({ data: { ...key, limit: FEATURED_LIMIT } });
    // 出演者 ID は落とす。フォローの印と絞り込みはシーズンのページにあり、
    // 抜粋では使わないので応答に載せない
    const featured = { ...key, anime: anime.map(({ actorIds: _actorIds, ...summary }) => summary) };

    return { seasons, origin, featured };
  },
  head: ({ loaderData, match }) => {
    const t = createTranslator(match.context.locale);
    const title = t("anime.indexMetaTitle", { app: t("app.name") });
    const description = t("anime.indexMetaDescription");
    const canonical = absoluteUrl(loaderData?.origin, "/anime");

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
  component: RouteComponent,
});

function absoluteUrl(origin: string | undefined, path: string): string {
  return origin ? `${origin}${path}` : path;
}

function RouteComponent() {
  const { seasons, featured } = Route.useLoaderData();
  return <AnimeIndexPage seasons={seasons} featured={featured} />;
}
