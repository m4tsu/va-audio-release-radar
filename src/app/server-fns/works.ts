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
    const [
      { env },
      { getDb },
      { getWorkById },
      { publicQuery },
      { audibleTrialLinkFor, withAffiliateUrls },
    ] = await Promise.all([
      import("cloudflare:workers"),
      import("@/server/db/client"),
      import("@/server/queries/works"),
      import("@/server/response-cache"),
      import("@/server/affiliate"),
    ]);
    const detail = await publicQuery("workById", { id: data.id }, async () => {
      return (await getWorkById(getDb(), data.id)) ?? null;
    });
    if (!detail) return null;
    const audibleTrial = audibleTrialLinkFor(detail.listings, env);
    return { ...withAffiliateUrls(detail, env), ...(audibleTrial ? { audibleTrial } : {}) };
  });

export const fetchWorksByActor = createServerFn({ method: "GET" })
  .validator(
    z.object({
      voiceActorId: z.string().min(1),
      limit: z.number().int().min(1).max(200).default(50),
    }),
  )
  .handler(async ({ data }) => {
    const [{ env }, { getDb }, { worksByActor }, { publicQuery }, { withAffiliateUrls }] =
      await Promise.all([
        import("cloudflare:workers"),
        import("@/server/db/client"),
        import("@/server/queries/works"),
        import("@/server/response-cache"),
        import("@/server/affiliate"),
      ]);
    const works = await publicQuery(
      "worksByActor",
      { voiceActorId: data.voiceActorId, limit: data.limit },
      () => worksByActor(getDb(), data.voiceActorId, { limit: data.limit }),
    );
    return works.map((item) => withAffiliateUrls(item, env));
  });

/**
 * 声優ごとの作品数と最新リリース。
 *
 * フォロー中の一覧が声優 ID をまとめて送るので、フィードと同じ理由で POST にしている
 * (GET だと ID が URL に並んで長さの上限に当たりうる。読み取りだが副作用は無い)
 */
export const fetchWorkStatsForActors = createServerFn({ method: "POST" })
  .validator(z.object({ voiceActorIds: z.array(z.string().min(1)).max(1000) }))
  .handler(async ({ data }) => {
    const [{ getDb }, { workStatsForActors }] = await Promise.all([
      import("@/server/db/client"),
      import("@/server/queries/works"),
    ]);
    return workStatsForActors(getDb(), data.voiceActorIds);
  });

export const fetchLatestWorks = createServerFn({ method: "GET" })
  .validator(
    // ストアは必須。指定なしの新着は窓の中の listing を全部読むので、外から呼ばせない (`latestWorks`)
    periodSchema.extend({ storeSlug: z.enum(STORE_SLUGS) }),
  )
  .handler(async ({ data }) => {
    const [{ env }, { getDb }, { latestWorks }, { publicQuery }, { withAffiliateUrls }] =
      await Promise.all([
        import("cloudflare:workers"),
        import("@/server/db/client"),
        import("@/server/queries/works"),
        import("@/server/response-cache"),
        import("@/server/affiliate"),
      ]);
    const works = await publicQuery(
      "latestWorks",
      { limit: data.limit, sinceDays: data.sinceDays, storeSlug: data.storeSlug },
      () =>
        latestWorks(getDb(), {
          limit: data.limit,
          sinceDays: data.sinceDays,
          storeSlug: data.storeSlug,
        }),
    );
    return works.map((item) => withAffiliateUrls(item, env));
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
    const [{ env }, { getDb }, { feedForActors }, { withAffiliateUrls }] = await Promise.all([
      import("cloudflare:workers"),
      import("@/server/db/client"),
      import("@/server/queries/works"),
      import("@/server/affiliate"),
    ]);
    const works = await feedForActors(getDb(), data.voiceActorIds, {
      limit: data.limit,
      sinceDays: data.sinceDays,
    });
    return works.map((item) => withAffiliateUrls(item, env));
  });
