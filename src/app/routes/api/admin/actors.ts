import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireBearer } from "@/server/auth";
import { getDb } from "@/server/db/client";
import { actorSeedSchema, listActorDictionary, upsertActors } from "@/server/queries/actors";
import { summarizeIssues } from "@/server/validation";

/**
 * 追跡する声優の読み書き。ingest と同じ Bearer トークンを使う (どれもクローラー側の運用操作のため)。
 *
 * GET は声優起点の走行が「誰を調べるか」を引くための辞書。`?never-crawled=1` で
 * 一度も引いていない声優だけ、`?with-works=1` で作品を持つ声優だけに絞れる。
 * POST は ID と slug を送り手が決めるシード投入で、AniList からの取り込みは
 * ID と slug をサーバーが決める `POST /api/admin/anilist` を使う
 */

const requestSchema = z.array(actorSeedSchema).min(1);

export const Route = createFileRoute("/api/admin/actors")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const unauthorized = requireBearer(request, env.INGEST_TOKEN);
        if (unauthorized) return unauthorized;

        // 絞り込みは 2 つ。週次のストア巡回は「一度も引いていない人」、
        // 月次の引き直しは「作品を持つ人」を対象にする
        const params = new URL(request.url).searchParams;
        const neverCrawled = params.get("never-crawled") === "1";
        const withWorks = params.get("with-works") === "1";
        return Response.json(await listActorDictionary(getDb(), { neverCrawled, withWorks }));
      },
      POST: async ({ request }) => {
        const unauthorized = requireBearer(request, env.INGEST_TOKEN);
        if (unauthorized) return unauthorized;

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "JSON として読めない本文" }, { status: 400 });
        }

        const parsed = requestSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json(
            { error: "シードが不正", issues: summarizeIssues(parsed.error) },
            { status: 400 },
          );
        }

        const result = await upsertActors(getDb(), parsed.data, new Date().toISOString());
        return Response.json(result);
      },
    },
  },
});
