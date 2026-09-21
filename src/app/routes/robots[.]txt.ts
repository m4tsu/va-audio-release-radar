import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { allowIndexing, robotsTxt } from "@/server/robots";
import { siteOrigin } from "@/server/site";

/**
 * robots.txt。本文の組み立てと公開の判定は `@/server/robots`。
 * Sitemap 行のオリジンは canonical / sitemap.xml と同じ `siteOrigin()` から取る
 */
export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const body = robotsTxt({
          origin: siteOrigin(request),
          allowIndexing: allowIndexing(env.ALLOW_INDEXING),
        });

        return new Response(body, {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            // 公開に切り替えたとき、古い「全部拒否」を長く掴まれないように短くする
            "cache-control": "public, max-age=300",
          },
        });
      },
    },
  },
});
