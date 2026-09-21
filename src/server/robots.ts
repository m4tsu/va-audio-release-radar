/**
 * robots.txt の本文。
 *
 * 公開前は**全部を拒否する**。デプロイした時点で URL は誰でも引けるので、
 * 検索から人が来ないようにする手段がこれしかない
 * (画面に認証を掛けない判断は `README.md` の「公開前の扱い」)。
 *
 * `allowIndexing` を分けてあるのは、`SITE_URL` のような別の目的の設定を
 * 公開判定に流用しないため。あちらは canonical のオリジンを決めるもので、
 * 空でも運用できてしまう
 */
export function robotsTxt(input: { origin: string; allowIndexing: boolean }): string {
  if (!input.allowIndexing) {
    return [
      "User-agent: *",
      "Disallow: /",
      "",
      // sitemap は出さない。拒否しているのに在り処を教えると、指定が食い違う
    ].join("\n");
  }

  return [
    "User-agent: *",
    "Disallow: /admin/",
    "Disallow: /api/",
    "",
    `Sitemap: ${input.origin}/sitemap.xml`,
    "",
  ].join("\n");
}

/**
 * 検索エンジンに載せてよいか。`wrangler.jsonc` の `vars` に置く。
 *
 * **既定は「載せない」**。設定を忘れたまま公開されるより、公開したのに載らないほうが
 * 気づきやすく、取り返しもつく
 */
export function allowIndexing(value: string | undefined): boolean {
  return value?.trim() === "1";
}
