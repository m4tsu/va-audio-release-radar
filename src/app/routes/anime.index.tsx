import { createFileRoute, redirect } from "@tanstack/react-router";
import { EmptyState } from "@/app/components/empty-state";
import { useT } from "@/app/i18n";
import { toSeasonSlug } from "@/app/lib/season";
import { fetchLatestAnimeSeason } from "@/app/server-fns/anime";

/**
 * アニメ導線の入口。中身は持たず、データがある最新シーズンへ送る。
 *
 * 一覧そのものは `/anime/season/$season` にあるので、ここで同じ内容を描くと
 * 同じ一覧が 2 つの URL に出る。「今期」を日付から決めないのも同じ理由で、
 * 実際に作品があるシーズンを DB に聞く (queries/anime.ts)
 */
export const Route = createFileRoute("/anime/")({
  loader: async () => {
    const season = await fetchLatestAnimeSeason();
    if (season) {
      throw redirect({
        to: "/anime/season/$season",
        params: { season: toSeasonSlug(season.seasonYear, season.season) },
      });
    }
    return null;
  },
  component: AnimeIndexPage,
});

/** 送り先が無いとき (アニメが 1 本も入っていないとき) だけ描かれる */
function AnimeIndexPage() {
  const t = useT();
  return <EmptyState title={t("anime.indexEmptyTitle")} />;
}
