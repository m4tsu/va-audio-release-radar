import { createFileRoute, redirect } from "@tanstack/react-router";
import { toSeasonSlug } from "@/app/lib/season";
import { AnimeIndexPage } from "@/app/pages/anime-index";
import { fetchLatestAnimeSeason } from "@/app/server-fns/anime";

/**
 * アニメ導線の入口。中身は持たず、データがある最新シーズンへ送る。
 *
 * 一覧そのものは `/anime/season/$season` にあるので、ここで同じ内容を描くと
 * 同じ一覧が 2 つの URL に出る。「今期」を日付から決めないのも同じ理由で、
 * 実際に作品があるシーズンを DB に聞く (queries/anime.ts)。
 * 送り先が無いときの画面は `@/app/pages/anime-index`
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
