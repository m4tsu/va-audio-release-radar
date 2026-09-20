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

/** 出せる作品があるシーズン。`/anime` の索引と、シーズン一覧の前後の導線が使う */
export const fetchAnimeSeasons = createServerFn({ method: "GET" }).handler(async () => {
  const [{ getDb }, { listSeasonsWithAnime }] = await Promise.all([
    import("@/server/db/client"),
    import("@/server/queries/anime"),
  ]);
  return listSeasonsWithAnime(getDb());
});

/**
 * フォロー中の声優が出ているアニメ。フォロー ID をブラウザから送る。
 *
 * GET にしないのは、フォロー中の声優の一覧が URL に載ると履歴とログに残るため (フィードと同じ)
 */
export const fetchAnimeForActors = createServerFn({ method: "POST" })
  .validator(
    z.object({
      voiceActorIds: z.array(z.string().min(1)).max(1000),
      limit: z.number().int().min(1).max(60),
    }),
  )
  .handler(async ({ data }) => {
    const [{ getDb }, { animeForActors }] = await Promise.all([
      import("@/server/db/client"),
      import("@/server/queries/anime"),
    ]);
    return animeForActors(getDb(), data.voiceActorIds, data.limit);
  });
