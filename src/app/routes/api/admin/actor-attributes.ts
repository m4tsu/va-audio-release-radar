import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireBearer } from "@/server/auth";
import { getDb } from "@/server/db/client";
import { actorAttributeSeedSchema, writeActorAttributes } from "@/server/queries/actor-attributes";
import { summarizeIssues } from "@/server/validation";

/**
 * 声優の付加情報 (かな、表示用ローマ字、公開状態) の書き込み。
 *
 * 出どころごとの行を書くので、かなを取る走行と人の訂正が同じ声優の同じ属性を
 * 書いても互いを消さない。ingest と同じ Bearer トークンを使う
 */

const requestSchema = z.array(actorAttributeSeedSchema).min(1);

export const Route = createFileRoute("/api/admin/actor-attributes")({
  server: {
    handlers: {
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
            { error: "付加情報が不正", issues: summarizeIssues(parsed.error) },
            { status: 400 },
          );
        }

        const result = await writeActorAttributes(getDb(), parsed.data, new Date().toISOString());
        return Response.json(result);
      },
    },
  },
});
