import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireBearer } from "@/server/auth";
import { getDb } from "@/server/db/client";
import { actorSeedSchema, upsertActors } from "@/server/queries/actors";
import { summarizeIssues } from "@/server/validation";

/**
 * 追跡する声優のシード投入。`crawler/actors.generated.json` をそのまま流し込む想定で、
 * ingest と同じ Bearer トークンを使う (どちらもクローラー側の運用操作のため)
 */

const requestSchema = z.array(actorSeedSchema).min(1);

export const Route = createFileRoute("/api/admin/actors")({
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
