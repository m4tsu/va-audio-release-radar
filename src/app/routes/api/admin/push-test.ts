import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireBearer } from "@/server/auth";
import { getDb } from "@/server/db/client";
import { createPushSender } from "@/server/push/send";
import { sendTestPush } from "@/server/push/test-send";
import { vapidFromEnv } from "@/server/push/vapid";
import { summarizeIssues } from "@/server/validation";

/**
 * 購読 1 件に試しの通知を送る。新作を待たずに、送信の経路が本番で通るかを確かめるためのもの。
 *
 * 秘密鍵は wrangler secret にあり読み出せないので、手元からではなく Worker の中で送る。
 * 購読の id は `push_subscriptions` から引く。応答は送信の結果 (`SendOutcome`) をそのまま返す
 */

const requestSchema = z.object({ subscriptionId: z.number().int().positive() });

export const Route = createFileRoute("/api/admin/push-test")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = requireBearer(request, env.ADMIN_TOKEN);
        if (unauthorized) return unauthorized;

        const vapid = vapidFromEnv(env);
        if (!vapid) {
          return Response.json({ error: "VAPID の設定が揃っていない" }, { status: 503 });
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "JSON として読めない本文" }, { status: 400 });
        }
        const parsed = requestSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json(
            { error: "subscriptionId が不正", issues: summarizeIssues(parsed.error) },
            { status: 400 },
          );
        }

        const outcome = await sendTestPush(
          getDb(),
          parsed.data.subscriptionId,
          createPushSender(vapid),
        );
        return Response.json(outcome, { status: outcome.kind === "not_found" ? 404 : 200 });
      },
    },
  },
});
