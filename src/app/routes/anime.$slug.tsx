import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { PageHeader } from "@/app/components/page-header";
import { createTranslator, useLocale, useT } from "@/app/i18n";
import { actorDisplayName } from "@/app/lib/actor-name";
import { animeAlternateTitle, animeDisplayTitle } from "@/app/lib/anime-title";
import { characterDisplayName } from "@/app/lib/character-name";
import { categoryLabel } from "@/app/lib/format";
import { safeHttpsUrl } from "@/app/lib/safe-url";
import { seasonLabel } from "@/app/lib/season";
import type { AnimeCastMember, AnimeDetail } from "@/app/lib/view-types";
import { fetchAnimeBySlug } from "@/app/server-fns/anime";
import { siteOriginForLoader } from "@/app/server-fns/site";

/**
 * アニメ 1 作品のページ。
 *
 * 出すのは「この作品の出演者で、音声作品を出している人」だけ。キャスト表ではないので
 * 全員は並べない。絞り込みは `getAnimeBySlug` 側でかけてあり、ここでは並べるだけ
 */
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
  component: AnimePage,
});

function absoluteUrl(origin: string | undefined, path: string): string {
  return origin ? `${origin}${path}` : path;
}

function AnimePage() {
  const t = useT();
  const locale = useLocale();
  const { anime } = Route.useLoaderData();
  const cover = safeHttpsUrl(anime.coverImageUrl);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start gap-4">
        {cover ? (
          <img
            src={cover}
            alt=""
            className="h-36 w-24 shrink-0 rounded-md object-cover"
            loading="lazy"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <PageHeader
            title={animeDisplayTitle(anime, locale)}
            description={<AnimeSubtitle anime={anime} />}
          />
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="font-semibold text-xl tracking-tight">{t("anime.castTitle")}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {anime.cast.map((member) => (
            <CastCard key={`${member.characterId}-${member.actor.id}`} member={member} />
          ))}
        </div>
      </section>
    </div>
  );
}

/** シーズンと、見出しに出していないほうのアニメ名 */
function AnimeSubtitle({ anime }: { anime: AnimeDetail }) {
  const t = useT();
  const locale = useLocale();
  return (
    <>
      {t("anime.subtitle", {
        season: seasonLabel(anime.seasonYear, anime.season, locale),
        alternate: animeAlternateTitle(anime, locale),
      })}
    </>
  );
}

function CastCard({ member }: { member: AnimeCastMember }) {
  const t = useT();
  const locale = useLocale();
  const characterImage = safeHttpsUrl(member.characterImageUrl);

  return (
    <Link
      to="/voice-actors/$slug"
      params={{ slug: member.actor.slug }}
      className="flex gap-3 rounded-xl border p-3 transition-colors hover:bg-accent"
    >
      {characterImage ? (
        <img
          src={characterImage}
          alt=""
          className="h-20 w-14 shrink-0 rounded-md object-cover"
          loading="lazy"
        />
      ) : null}
      <div className="min-w-0 space-y-1">
        <div className="flex items-baseline gap-2">
          <span className="font-medium">{characterDisplayName(member, locale)}</span>
          <span className="text-muted-foreground text-xs">
            {member.role === "main" ? t("anime.roleMain") : t("anime.roleSupporting")}
          </span>
        </div>
        <p className="text-sm">{actorDisplayName(member.actor, locale)}</p>
        <p className="text-muted-foreground text-xs">
          {member.workCounts.length === 0
            ? t("anime.hasAudioWorks")
            : member.workCounts
                .map((item) =>
                  t("anime.workCount", {
                    category: categoryLabel(item.category, locale),
                    count: item.count,
                  }),
                )
                .join(t("common.slashSeparator"))}
        </p>
      </div>
    </Link>
  );
}
