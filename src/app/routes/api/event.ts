import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { handleUsageEvent, webAnalyticsToken } from "@/server/usage-events";

/**
 * 画面の操作 (フォロー、ストアへの送客) を 1 件受け取って数える。送り手は `@/app/lib/usage-events`。
 * 認可は無い。受け取るのは操作の種類とストアの別だけで、偽の送信で動くのは数字だけになる
 */
export const Route = createFileRoute("/api/event")({
  server: {
    handlers: {
      POST: ({ request }) =>
        handleUsageEvent(request, {
          enabled: webAnalyticsToken(env.WEB_ANALYTICS_TOKEN) !== null,
          dataset: env.EVENTS,
        }),
    },
  },
});
