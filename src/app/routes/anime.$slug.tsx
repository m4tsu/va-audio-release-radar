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
    // 出演が 1 件も無い作品だけ null が返る。出せるものが題しか無いので 404 にする
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
        // 音声作品がある出演者が 1 人も居ないページは、出せるのが役名と名前だけ。
        // フォローの入口としては要るが、検索結果に並べても読む中身が無いので載せない。
        // sitemap 側も同じ条件で外している (`animeSitemapEntries`)
        ...(anime.actorCount > 0 ? [] : [{ name: "robots", content: "noindex" } as const]),
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
