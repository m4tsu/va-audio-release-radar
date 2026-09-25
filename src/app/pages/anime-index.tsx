import { Link } from "@tanstack/react-router";
import { useId } from "react";
import { AnimeCard } from "@/app/components/anime-card";
import { AnimeSearch } from "@/app/components/anime-search";
import { EmptyState } from "@/app/components/empty-state";
import { PageHeader } from "@/app/components/page-header";
import { useLocale, useT } from "@/app/i18n";
import { seasonLabel, toSeasonSlug } from "@/app/lib/season";
import type { AnimeSeasonEntry, AnimeSummary } from "@/app/lib/view-types";
import type { SeasonKey } from "@/domain/season";

/**
 * アニメ導線の入口。放送中シーズンの抜粋、アニメ名の検索、出せる作品があるシーズンの索引。
 *
 * 抜粋を先頭に置くのは、開いた人が検索も選択もせずに今のアニメを見られるようにするため。
 * 最新シーズンへ転送しないのは、持っているシーズンのうち 1 つにしか画面から届かなくなるため。
 * 検索と索引を抜粋の下に残すのは、放送時期を覚えていない人と、古いシーズンを見たい人の経路
 */
export function AnimeIndexPage({
  seasons,
  featured,
}: {
  seasons: AnimeSeasonEntry[];
  /** 先頭に出すシーズンと、その人気順の先頭数件。出せる作品があるシーズンが無ければ null */
  featured: FeaturedSeason | null;
}) {
  const t = useT();

  if (seasons.length === 0) {
    return (
      <div>
        <PageHeader title={t("anime.indexTitle")} />
        <EmptyState title={t("anime.indexEmptyTitle")} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader title={t("anime.indexTitle")} />

      {featured ? <FeaturedSeasonSection featured={featured} /> : null}

      <AnimeSearch />

      <SeasonIndex seasons={seasons} />
    </div>
  );
}

/** 先頭に出すシーズンと、その抜粋。並べ替えとフォローの絞り込みはシーズンのページに置く */
export type FeaturedSeason = SeasonKey & { anime: AnimeSummary[] };

function FeaturedSeasonSection({ featured }: { featured: FeaturedSeason }) {
  const t = useT();
  const locale = useLocale();
  const headingId = useId();
  const label = seasonLabel(featured.seasonYear, featured.season, locale);
  const seasonSlug = toSeasonSlug(featured.seasonYear, featured.season);

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h2 id={headingId} className="font-semibold text-lg tracking-tight">
        {t("anime.seasonTitle", { season: label })}
      </h2>

      {featured.anime.length === 0 ? (
        <EmptyState title={t("anime.seasonEmptyTitle", { season: label })} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {featured.anime.map((anime) => (
            <li key={anime.slug}>
              <AnimeCard anime={anime} />
            </li>
          ))}
        </ul>
      )}

      <Link
        to="/anime/season/$season"
        params={{ season: seasonSlug }}
        className="inline-block text-sm underline underline-offset-4"
      >
        {t("anime.seeWholeSeason")}
      </Link>
    </section>
  );
}

function SeasonIndex({ seasons }: { seasons: AnimeSeasonEntry[] }) {
  const t = useT();
  const locale = useLocale();

  return (
    <ul
      aria-label={t("anime.seasonListLabel")}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      {seasons.map((entry) => (
        <li key={toSeasonSlug(entry.seasonYear, entry.season)}>
          <Link
            to="/anime/season/$season"
            params={{ season: toSeasonSlug(entry.seasonYear, entry.season) }}
            className="flex items-baseline justify-between gap-3 rounded-xl border p-4 transition-colors hover:bg-accent"
          >
            <span className="font-medium">
              {seasonLabel(entry.seasonYear, entry.season, locale)}
            </span>
            <span className="text-muted-foreground text-xs">
              {t("anime.titleCount", { count: entry.animeCount })}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
