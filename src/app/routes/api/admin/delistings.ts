import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireBearer } from "@/server/auth";
import { getDb } from "@/server/db/client";
import { delistingSchema, recordDelistings } from "@/server/queries/delistings";
import { summarizeIssues } from "@/server/validation";

/**
 * 販売終了の記録。台帳が持っている商品を引き直した結果だけを受け取る。
 *
 * 作品の中身は触らない。取り下げは listing の状態で、作品そのものは残る
 * (`docs/decisions/0008-no-price-no-availability.md`)。
 * ingest と同じ Bearer トークンを使う
 */

const requestSchema = z.array(delistingSchema).min(1);

export const Route = createFileRoute("/api/admin/delistings")({
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
            { error: "判定が不正", issues: summarizeIssues(parsed.error) },
            { status: 400 },
          );
        }

        const result = await recordDelistings(getDb(), parsed.data, new Date().toISOString());
        return Response.json(result);
      },
    },
  },
});
