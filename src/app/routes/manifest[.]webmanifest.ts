import { createFileRoute } from "@tanstack/react-router";
import { webManifest } from "@/app/lib/manifest";
import { resolveLocaleFromHeaders } from "@/app/server-fns/locale";

/**
 * Web アプリマニフェスト。中身は `@/app/lib/manifest`。
 * 言語はページと同じ規則 (cookie → Accept-Language → 日本語) で決めるので、
 * 静的ファイルではなくここで組む
 */
export const Route = createFileRoute("/manifest.webmanifest")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const body = JSON.stringify(webManifest(resolveLocaleFromHeaders(request.headers)));
        return new Response(body, {
          headers: {
            "content-type": "application/manifest+json; charset=utf-8",
            // 言語 cookie で中身が変わるので、共有キャッシュには載せない
            "cache-control": "private, max-age=3600",
          },
        });
      },
    },
  },
});
