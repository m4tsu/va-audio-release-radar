import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * 画面から呼ぶ声優まわりの server function。
 *
 * `@/server/**` は D1 バインディングに触るサーバー専用コードで、vite.config.ts の
 * importProtection でクライアントから import できない。handler の中で動的 import すれば
 * クライアントバンドルには入らないため、この形で統一する
 */

export const fetchActorBySlug = createServerFn({ method: "GET" })
  .validator(z.object({ slug: z.string().min(1) }))
  .handler(async ({ data }) => {
    const [{ getDb }, { getActorBySlug }, { publicQuery }] = await Promise.all([
      import("@/server/db/client"),
      import("@/server/queries/actors"),
      import("@/server/response-cache"),
    ]);
    return publicQuery("actorBySlug", { slug: data.slug }, async () => {
      return (await getActorBySlug(getDb(), data.slug)) ?? null;
    });
  });

/**
 * ストアごとに、この声優の作品を取り切れているか。声優ページが「一部しか載っていない」注記を
 * 出すかどうかの判定に使う
 */
export const fetchActorStoreCoverage = createServerFn({ method: "GET" })
  .validator(z.object({ voiceActorId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const [{ getDb }, { getActorStoreCoverage }, { publicQuery }] = await Promise.all([
      import("@/server/db/client"),
      import("@/server/queries/actors"),
      import("@/server/response-cache"),
    ]);
    return publicQuery("actorStoreCoverage", { voiceActorId: data.voiceActorId }, () =>
      getActorStoreCoverage(getDb(), data.voiceActorId),
    );
  });

export const searchActorsFn = createServerFn({ method: "GET" })
  .validator(
    z.object({
      q: z.string(),
      limit: z.number().int().min(1).max(100).default(20),
    }),
  )
  .handler(async ({ data }) => {
    const [{ getDb }, { searchActors }, { markPublicData }] = await Promise.all([
      import("@/server/db/client"),
      import("@/server/queries/actors"),
      import("@/server/response-cache"),
    ]);
    // 打鍵ごとに検索語が変わってほぼ当たらないので、クエリ結果のキャッシュには置かない
    markPublicData();
    return searchActors(getDb(), data.q, data.limit);
  });

export const fetchAllActors = createServerFn({ method: "GET" }).handler(async () => {
  const [{ getDb }, { listActors }, { publicQuery }] = await Promise.all([
    import("@/server/db/client"),
    import("@/server/queries/actors"),
    import("@/server/response-cache"),
  ]);
  return publicQuery("allActors", {}, () => listActors(getDb()));
});
