import { createFileRoute, notFound } from "@tanstack/react-router";
import { createTranslator } from "@/app/i18n";
import { adjacentSeasons, parseSeasonSlug, seasonLabel, toSeasonSlug } from "@/app/lib/season";
import { AnimeSeasonPage } from "@/app/pages/anime-season";
import { fetchAnimeSeasons, fetchSeasonAnime } from "@/app/server-fns/anime";
import { siteOriginForLoader } from "@/app/server-fns/site";

/** シーズンのアニメ一覧。画面は `@/app/pages/anime-season` */
export const Route = createFileRoute("/anime/season/$season")({
  loader: async ({ params }) => {
    const parsed = parseSeasonSlug(params.season);
    if (!parsed) throw notFound();

    // 前後の 2 件のためにシーズン一覧を丸ごと引く。隣だけを引くクエリを別に持つより、
    // 索引と同じ 1 本を使い回すほうが「実際に作品があるシーズンの並び」の定義が 1 つで済む。
    // 返るのはシーズンの数 (たかだか数十行) で、作品の行は含まない
    const [anime, seasons, origin] = await Promise.all([
      fetchSeasonAnime({ data: parsed }),
      fetchAnimeSeasons(),
      siteOriginForLoader(),
    ]);

    return { anime, origin, ...parsed, ...adjacentSeasons(seasons, parsed) };
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
  component: RouteComponent,
});

function absoluteUrl(origin: string | undefined, path: string): string {
  return origin ? `${origin}${path}` : path;
}

function RouteComponent() {
  const { anime, seasonYear, season, older, newer } = Route.useLoaderData();
  return (
    // シーズンを移ったら画面の状態 (並べ替え・絞り込み) を捨てる。
    // key が無いと React が同じ要素として作り直さず、前のシーズンの選択が残る
    <AnimeSeasonPage
      key={toSeasonSlug(seasonYear, season)}
      anime={anime}
      seasonYear={seasonYear}
      season={season}
      older={older}
      newer={newer}
    />
  );
}
