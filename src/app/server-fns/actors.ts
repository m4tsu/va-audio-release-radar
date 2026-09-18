import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * 画面から呼ぶ声優まわりの server function (設計書 §7)。
 *
 * `@/server/**` は D1 バインディングに触るサーバー専用コードで、vite.config.ts の
 * importProtection でクライアントから import できない。handler の中で動的 import すれば
 * クライアントバンドルには入らないため、この形で統一する
 */

export const fetchActorBySlug = createServerFn({ method: "GET" })
  .validator(z.object({ slug: z.string().min(1) }))
  .handler(async ({ data }) => {
    const [{ getDb }, { getActorBySlug }] = await Promise.all([
      import("@/server/db/client"),
      import("@/server/queries/actors"),
    ]);
    return (await getActorBySlug(getDb(), data.slug)) ?? null;
  });

export const searchActorsFn = createServerFn({ method: "GET" })
  .validator(
    z.object({
      q: z.string(),
      limit: z.number().int().min(1).max(100).default(20),
    }),
  )
  .handler(async ({ data }) => {
    const [{ getDb }, { searchActors }] = await Promise.all([
      import("@/server/db/client"),
      import("@/server/queries/actors"),
    ]);
    return searchActors(getDb(), data.q, data.limit);
  });

export const fetchAllActors = createServerFn({ method: "GET" }).handler(async () => {
  const [{ getDb }, { listActors }] = await Promise.all([
    import("@/server/db/client"),
    import("@/server/queries/actors"),
  ]);
  return listActors(getDb());
});
