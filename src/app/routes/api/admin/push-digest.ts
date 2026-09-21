import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { requireBearer } from "@/server/auth";
import { getDb } from "@/server/db/client";
import { planDigest } from "@/server/push/digest";
import { vapidFromEnv } from "@/server/push/vapid";

/**
 * ダイジェストの下見。実際には送らず、今起動したら誰に何を送るかを返す。
 *
 * cron の起動は手元で再現しにくいので、送る内容だけをここで確かめる。
 * `?at=` に時刻 (ISO 8601) を渡すと、その時刻に起動したものとして予定時刻を決める。
 * `?after=` と `?limit=` は購読の続きを読むためのもの (`planDigest` と同じ意味)。
 * 宛先の URL は送信の権限そのものなので返さず、ホスト名だけにする
 */
export const Route = createFileRoute("/api/admin/push-digest")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const unauthorized = requireBearer(request, env.ADMIN_TOKEN);
        if (unauthorized) return unauthorized;

        const params = new URL(request.url).searchParams;
        const at = params.get("at") ?? new Date().toISOString();
        if (Number.isNaN(Date.parse(at))) {
          return Response.json({ error: "at は ISO 8601 の日時を指定する" }, { status: 400 });
        }
        const afterId = Number(params.get("after") ?? "0");
        const limit = Number(params.get("limit") ?? "100");
        if (!Number.isInteger(afterId) || afterId < 0 || !Number.isInteger(limit) || limit < 1) {
          return Response.json(
            { error: "after は 0 以上、limit は 1 以上の整数" },
            { status: 400 },
          );
        }

        const plan = await planDigest(getDb(), { now: at, afterId, limit });
        return Response.json({
          configured: vapidFromEnv(env) !== null,
          window: plan.window,
          lastId: plan.lastId,
          skippedCount: plan.skipped.length,
          targets: plan.targets.map((target) => ({
            id: target.subscription.id,
            endpointHost: new URL(target.subscription.endpoint).host,
            locale: target.subscription.locale,
            voiceActorIds: target.subscription.voiceActorIds,
            works: target.works,
            message: target.message,
          })),
        });
      },
    },
  },
});
