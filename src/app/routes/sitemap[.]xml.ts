import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/server/db/client";
import { animeSitemapEntries } from "@/server/queries/anime";
import { sitemapEntries } from "@/server/queries/works";
import { siteOrigin } from "@/server/site";

/**
 * sitemap.xml。声優ページを検索エンジンにインデックスさせるのが目的なので、
 * 声優と作品の URL を並べる。ファイル名の `[.]` は TanStack Router の
 * 「リテラルのドット」のエスケープで、ルートは `/sitemap.xml` になる。
 *
 * オリジンは `@/server/site` の `siteOrigin()` で決める。canonical と同じ値にしないと
 * sitemap が指す URL と canonical がずれて、どちらを正とするかで揺れるため
 */

/** 1 日に 1 回しかクロールしないので、それより短く再取得されても中身は変わらない */
const CACHE_MAX_AGE_SECONDS = 3600;

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = siteOrigin(request);
        const [{ actors, works }, anime] = await Promise.all([
          sitemapEntries(getDb()),
          animeSitemapEntries(getDb()),
        ]);

        const urls = [
          buildUrl(origin, "/"),
          buildUrl(origin, "/terms"),
          buildUrl(origin, "/privacy"),
          ...actors.map((actor) =>
            buildUrl(origin, `/voice-actors/${actor.slug}`, actor.updatedAt),
          ),
          ...works.map((work) => buildUrl(origin, `/works/${work.id}`, work.updatedAt)),
          // 出演者が全員「音声作品なし」のアニメは animeSitemapEntries が返さないので、
          // 404 になるページが sitemap に載ることはない
          ...anime.map((item) => buildUrl(origin, `/anime/${item.slug}`, item.updatedAt)),
        ];

        const xml = [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
          ...urls,
          "</urlset>",
        ].join("\n");

        return new Response(xml, {
          headers: {
            "content-type": "application/xml; charset=utf-8",
            "cache-control": `public, max-age=${CACHE_MAX_AGE_SECONDS}`,
          },
        });
      },
    },
  },
});

function buildUrl(origin: string, path: string, lastModified?: string): string {
  const parts = [`  <url>`, `    <loc>${escapeXml(origin + encodePath(path))}</loc>`];
  if (lastModified) {
    // sitemap の lastmod は W3C Datetime。ISO 文字列の日付部分だけで十分
    parts.push(`    <lastmod>${escapeXml(lastModified.slice(0, 10))}</lastmod>`);
  }
  parts.push(`  </url>`);
  return parts.join("\n");
}

/** 作品 ID は "dlsite:RJ01698658" のようにコロンを含むので、パスとして安全な形にする */
function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
