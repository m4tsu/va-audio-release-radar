import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { STORE_SLUGS } from "@/domain/types";

/** 作品・新着まわりの server function。import の方針は server-fns/actors.ts と同じ */

/**
 * 既定値はスキーマと「引数なしで呼べる」ための default の両方で使うので定数にする。
 * 期間はフィード (直近 90 日 + 発売予定) に合わせる
 */
const PERIOD_DEFAULTS = { sinceDays: 90, limit: 50 };

const periodSchema = z.object({
  sinceDays: z.number().int().min(1).max(365).default(PERIOD_DEFAULTS.sinceDays),
  limit: z.number().int().min(1).max(200).default(PERIOD_DEFAULTS.limit),
});

export const fetchWork = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    const [{ getDb }, { getWorkById }] = await Promise.all([
      import("@/server/db/client"),
      import("@/server/queries/works"),
    ]);
    return (await getWorkById(getDb(), data.id)) ?? null;
  });

export const fetchWorksByActor = createServerFn({ method: "GET" })
  .validator(
    z.object({
      voiceActorId: z.string().min(1),
      storeSlug: z.enum(STORE_SLUGS).optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }),
  )
  .handler(async ({ data }) => {
    const [{ getDb }, { worksByActor }] = await Promise.all([
      import("@/server/db/client"),
      import("@/server/queries/works"),
    ]);
    return worksByActor(getDb(), data.voiceActorId, {
      limit: data.limit,
      ...(data.storeSlug ? { storeSlug: data.storeSlug } : {}),
    });
  });

export const fetchLatestWorks = createServerFn({ method: "GET" })
  .validator(periodSchema.default(PERIOD_DEFAULTS))
  .handler(async ({ data }) => {
    const [{ getDb }, { latestWorks }] = await Promise.all([
      import("@/server/db/client"),
      import("@/server/queries/works"),
    ]);
    return latestWorks(getDb(), { limit: data.limit, sinceDays: data.sinceDays });
  });

/**
 * フォロー中の声優の新着。
 *
 * フォローはブラウザ内にしか無いので声優 id の配列を丸ごと送る。GET だと id が URL に並んで
 * 長さの上限に当たりうるため POST にしている (読み取りだが副作用は無い)
 */
export const fetchFeed = createServerFn({ method: "POST" })
  .validator(
    periodSchema.extend({
      voiceActorIds: z.array(z.string().min(1)).max(1000),
    }),
  )
  .handler(async ({ data }) => {
    const [{ getDb }, { feedForActors }] = await Promise.all([
      import("@/server/db/client"),
      import("@/server/queries/works"),
    ]);
    return feedForActors(getDb(), data.voiceActorIds, {
      limit: data.limit,
      sinceDays: data.sinceDays,
    });
  });
