import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { actorKanaRequestSchema } from "@/contract";
import { requireBearer } from "@/server/auth";
import { dataChangedHeaders } from "@/server/cache-policy";
import { getDb } from "@/server/db/client";
import { listActorsNeedingKana, writeActorKana } from "@/server/queries/actor-attributes";
import { summarizeIssues } from "@/server/validation";

/**
 * かなの取得の入口。
 *
 * GET は「まだ引いていない声優」を古い順に返す。かなを持っていない人ではなく引いていない人で
 * 選ぶので、記事が無い声優を毎週引き直さない。
 * POST は取得結果を入れる。かなが取れなかった人も送ると、引いた印だけが付く。
 * ingest と同じ Bearer トークンを使う
 */

/** 1 回に返す人数の既定。走行の時間に収まる数を呼び出し側が決める */
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

export const Route = createFileRoute("/api/admin/actor-kana")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const unauthorized = requireBearer(request, env.INGEST_TOKEN);
        if (unauthorized) return unauthorized;

        const raw = new URL(request.url).searchParams.get("limit");
        const limit = raw === null ? DEFAULT_LIMIT : Number(raw);
        if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
          return Response.json(
            { error: `limit は 1 以上 ${MAX_LIMIT} 以下の整数を指定する` },
            { status: 400 },
          );
        }

        return Response.json(await listActorsNeedingKana(getDb(), limit));
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

        const parsed = actorKanaRequestSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json(
            { error: "取得結果が不正", issues: summarizeIssues(parsed.error) },
            { status: 400 },
          );
        }

        const result = await writeActorKana(getDb(), parsed.data, new Date().toISOString());
        return Response.json(result, { headers: dataChangedHeaders(true) });
      },
    },
  },
});
