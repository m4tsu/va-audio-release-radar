import { createFileRoute, notFound } from "@tanstack/react-router";
import { createTranslator } from "@/app/i18n";
import { animeDisplayTitle } from "@/app/lib/anime-title";
import { AnimePage } from "@/app/pages/anime";
import { fetchAnimeBySlug } from "@/app/server-fns/anime";
import { siteOriginForLoader } from "@/app/server-fns/site";

/** アニメ 1 作品のページ。画面は `@/app/pages/anime` */
export const Route = createFileRoute("/anime/$slug")({
  loader: async ({ params }) => {
    const [anime, origin] = await Promise.all([
      fetchAnimeBySlug({ data: { slug: params.slug } }),
      siteOriginForLoader(),
    ]);
    // 音声作品を持つ出演者が 0 人なら null が返る。中身の無いページを 200 で返すと、
    // 検索エンジンから見て薄いページが作品数ぶん並ぶため 404 にする (声優ページと同じ)
    if (!anime) throw notFound();

    return { anime, origin };
  },
  head: ({ loaderData, params, match }) => {
    const anime = loaderData?.anime;
    if (!anime) return {};

    // 作品名は AniList 由来のデータ。訳さず、表示言語に合う表記を選ぶだけ
    const locale = match.context.locale;
    const t = createTranslator(locale);
    const animeTitle = animeDisplayTitle(anime, locale);
    const title = t("anime.metaTitle", { title: animeTitle });
    const description = t("anime.metaDescription", {
      title: animeTitle,
      count: anime.actorCount,
    });
    const canonical = absoluteUrl(loaderData?.origin, `/anime/${params.slug}`);

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
  const { anime } = Route.useLoaderData();
  return <AnimePage anime={anime} />;
}
