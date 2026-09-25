/**
 * 表紙画像を持たないページが og:image に出すサイト共通の画像。
 * 画像は `scripts/generate-icons.mjs` が作り、`public/` に置いてある。大きさはそこで決めた値と揃える
 */
const SITE_IMAGE = { path: "/og-image.png", width: 1200, height: 630 } as const;

/**
 * og:image は絶対 URL でないと SNS のクローラーが読まない。オリジンは loader が
 * `siteOriginForLoader()` で解決したものを受け取る (`SITE_URL` が空なら来たリクエストのオリジン)
 */
export function siteImageMeta(origin: string) {
  return [
    { property: "og:image", content: `${origin}${SITE_IMAGE.path}` },
    { property: "og:image:width", content: String(SITE_IMAGE.width) },
    { property: "og:image:height", content: String(SITE_IMAGE.height) },
  ];
}
