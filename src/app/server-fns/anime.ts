import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ANIME_SEASONS } from "@/domain/types";

/**
 * 画面から呼ぶアニメ導線の server function。
 *
 * `@/server/**` は D1 バインディングに触るサーバー専用コードで、vite.config.ts の
 * importProtection でクライアントから import できない。handler の中で動的 import すれば
 * クライアントバンドルには入らないため、`actors.ts` と同じ形で統一する
 */

const seasonInput = z.object({
  seasonYear: z.number().int(),
  season: z.enum(ANIME_SEASONS),
});

export const fetchSeasonAnime = createServerFn({ method: "GET" })
  .validator(seasonInput)
  .handler(async ({ data }) => {
    const [{ getDb }, { listSeasonAnime }] = await Promise.all([
      import("@/server/db/client"),
      import("@/server/queries/anime"),
    ]);
    return listSeasonAnime(getDb(), data.seasonYear, data.season);
  });

export const fetchAnimeBySlug = createServerFn({ method: "GET" })
  .validator(z.object({ slug: z.string().min(1) }))
  .handler(async ({ data }) => {
    const [{ getDb }, { getAnimeBySlug }] = await Promise.all([
      import("@/server/db/client"),
      import("@/server/queries/anime"),
    ]);
    return (await getAnimeBySlug(getDb(), data.slug)) ?? null;
  });

export const fetchAnimeByActor = createServerFn({ method: "GET" })
  .validator(z.object({ voiceActorId: z.string().min(1), limit: z.number().int().min(1).max(50) }))
  .handler(async ({ data }) => {
    const [{ getDb }, { animeByActor }] = await Promise.all([
      import("@/server/db/client"),
      import("@/server/queries/anime"),
    ]);
    return animeByActor(getDb(), data.voiceActorId, data.limit);
  });

export const fetchLatestAnimeSeason = createServerFn({ method: "GET" }).handler(async () => {
  const [{ getDb }, { latestSeasonWithAnime }] = await Promise.all([
    import("@/server/db/client"),
    import("@/server/queries/anime"),
  ]);
  return (await latestSeasonWithAnime(getDb())) ?? null;
});
