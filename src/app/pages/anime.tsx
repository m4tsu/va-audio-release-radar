import { Link } from "@tanstack/react-router";
import { PageHeader } from "@/app/components/page-header";
import { useLocale, useT } from "@/app/i18n";
import { actorDisplayName } from "@/app/lib/actor-name";
import { animeAlternateTitle, animeDisplayTitle } from "@/app/lib/anime-title";
import { characterDisplayName } from "@/app/lib/character-name";
import { categoryLabel } from "@/app/lib/format";
import { safeHttpsUrl } from "@/app/lib/safe-url";
import { seasonLabel } from "@/app/lib/season";
import type { AnimeCastMember, AnimeDetail } from "@/app/lib/view-types";

/**
 * アニメ 1 作品のページ。
 *
 * 出すのは「この作品の出演者で、音声作品を出している人」だけ。キャスト表ではないので
 * 全員は並べない。絞り込みは `getAnimeBySlug` 側でかけてあり、ここでは並べるだけ
 */
export function AnimePage({ anime }: { anime: AnimeDetail }) {
  const t = useT();
  const locale = useLocale();
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
