import { Link } from "@tanstack/react-router";
import { EmptyState } from "@/app/components/empty-state";
import { PageHeader } from "@/app/components/page-header";
import { useLocale, useT } from "@/app/i18n";
import { animeDisplayTitle } from "@/app/lib/anime-title";
import { safeHttpsUrl } from "@/app/lib/safe-url";
import { seasonLabel } from "@/app/lib/season";
import type { AnimeSummary } from "@/app/lib/view-types";
import type { AnimeSeason } from "@/domain/types";

/**
 * シーズンのアニメ一覧。
 *
 * 声優名を知らない利用者がアニメから入ってくる経路。放送中のアニメは毎クール入れ替わるので、
 * back catalog 中心の他のページに無い「時期性」をここが受け持つ
 */
export function AnimeSeasonPage({
  anime,
  seasonYear,
  season,
}: {
  anime: AnimeSummary[];
  seasonYear: number;
  season: AnimeSeason;
}) {
  const t = useT();
  const locale = useLocale();
  const label = seasonLabel(seasonYear, season, locale);

  return (
    <div className="space-y-6">
      <PageHeader title={t("anime.seasonTitle", { season: label })} />

      {anime.length === 0 ? (
        <EmptyState title={t("anime.seasonEmptyTitle", { season: label })} />
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
  const locale = useLocale();
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
        <p className="font-medium leading-snug">{animeDisplayTitle(anime, locale)}</p>
        <p className="text-muted-foreground text-xs">
          {t("anime.actorCount", { count: anime.actorCount })}
        </p>
      </div>
    </Link>
  );
}
