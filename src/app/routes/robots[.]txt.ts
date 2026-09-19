import { createFileRoute } from "@tanstack/react-router";
import { siteOrigin } from "@/server/site";

/**
 * robots.txt。声優ページと作品ページはインデックスさせたいので全体は許可し、
 * 管理画面と JSON API だけ弾く。sitemap の場所もここから示す。
 * Sitemap 行のオリジンは canonical / sitemap.xml と同じ `siteOrigin()` から取る
 */
export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const origin = siteOrigin(request);
        const body = [
          "User-agent: *",
          "Disallow: /admin/",
          "Disallow: /api/",
          "",
          `Sitemap: ${origin}/sitemap.xml`,
          "",
        ].join("\n");

        return new Response(body, {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
