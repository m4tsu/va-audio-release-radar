import { createServerFn } from "@tanstack/react-start";

/**
 * 公開 URL のオリジンを取る server function。
 *
 * canonical / og:url は絶対 URL で出したいが、`head()` は SSR とクライアントの両方で動くので、
 * `env.SITE_URL` や実リクエストのホストをそこから直接は読めない。
 * ローダー (SSR ではサーバー側で動く) でこれを呼び、loaderData に載せて `head()` へ渡す。
 */
const fetchSiteOriginFn = createServerFn({ method: "GET" }).handler(async () => {
  const { siteOrigin } = await import("@/server/site");
  return siteOrigin();
});

/**
 * ブラウザ側の画面遷移でだけ結果を使い回す。同じタブでオリジンが変わることはないので、
 * ページを移るたびに RPC を投げる必要がない。
 *
 * サーバー側ではキャッシュしない。Worker のモジュール変数はリクエストをまたいで生き残るため、
 * 最初のリクエストのホストを別のホストの応答に混ぜてしまう (`SITE_URL` 未設定時に効いてくる)
 */
let cachedClientOrigin: string | undefined;

export async function siteOriginForLoader(): Promise<string> {
  const onClient = typeof window !== "undefined";
  if (onClient && cachedClientOrigin !== undefined) return cachedClientOrigin;

  const origin = await fetchSiteOriginFn();
  if (onClient) cachedClientOrigin = origin;
  return origin;
}
