import { createFileRoute } from "@tanstack/react-router";
import { createTranslator } from "@/app/i18n";
import { AnimeIndexPage } from "@/app/pages/anime-index";
import { fetchAnimeSeasons } from "@/app/server-fns/anime";
import { siteOriginForLoader } from "@/app/server-fns/site";

/** アニメ導線の入口。アニメ名の検索とシーズンの索引。画面は `@/app/pages/anime-index` */
export const Route = createFileRoute("/anime/")({
  loader: async () => {
    const [seasons, origin] = await Promise.all([fetchAnimeSeasons(), siteOriginForLoader()]);
    return { seasons, origin };
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
  const { seasons } = Route.useLoaderData();
  return <AnimeIndexPage seasons={seasons} />;
}
