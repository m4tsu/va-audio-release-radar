import { Link } from "@tanstack/react-router";
import { EmptyState } from "@/app/components/empty-state";
import { PageHeader } from "@/app/components/page-header";
import { useLocale, useT } from "@/app/i18n";
import { seasonLabel, toSeasonSlug } from "@/app/lib/season";
import type { AnimeSeasonEntry } from "@/app/lib/view-types";

/**
 * アニメ導線の入口。出せる作品があるシーズンを新しい順に並べる。
 *
 * 最新シーズンへ送らないのは、持っているシーズンのうち 1 つにしか画面から届かなくなるため。
 * 「今期」を日付から決めないのも同じで、並ぶのは実際に作品があるシーズンだけ (queries/anime.ts)
 */
export function AnimeIndexPage({ seasons }: { seasons: AnimeSeasonEntry[] }) {
  const t = useT();
  const locale = useLocale();

  if (seasons.length === 0) {
    return (
      <div>
        <PageHeader title={t("anime.indexTitle")} />
        <EmptyState title={t("anime.indexEmptyTitle")} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("anime.indexTitle")} description={t("anime.indexDescription")} />

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
    </div>
  );
}
