import { createServerFn } from "@tanstack/react-start";

/**
 * Cloudflare Web Analytics のトークンを取る。`head()` は SSR とブラウザの両方で動き
 * `env` を読めないので、ルートの loader でこれを呼んで loaderData に載せる。null なら計測しない
 */
export const fetchWebAnalyticsToken = createServerFn({ method: "GET" }).handler(
  async (): Promise<string | null> => {
    const [{ env }, { webAnalyticsToken }] = await Promise.all([
      import("cloudflare:workers"),
      import("@/server/usage-events"),
    ]);
    return webAnalyticsToken(env.WEB_ANALYTICS_TOKEN);
  },
);
