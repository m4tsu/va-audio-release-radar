import handler from "@tanstack/react-start/server-entry";

/**
 * Worker の入口。HTTP は TanStack Start の既定の入口にそのまま渡し、cron (`scheduled`) だけを足す。
 *
 * 既定の入口 (`@tanstack/react-start/server-entry`) は `fetch` しか持たず、cron の起動を受け取れない。
 * `wrangler.jsonc` の `main` はこのファイルを指す。ダイジェストの段取りは `@/server/push/digest`
 */

const start = handler as unknown as {
  fetch: (...args: unknown[]) => Promise<Response> | Response;
};

export default {
  fetch: (request, env, ctx) => start.fetch(request, env, ctx),
  scheduled: async () => {
    // 返した Promise が終わるまで起動は続く。途中の例外はそのまま起動の失敗として記録される
    // (waitUntil に渡すと、失敗してもこの起動は成功と数えられる)
    const { runScheduledDigest } = await import("@/server/push/scheduled");
    await runScheduledDigest();
  },
} satisfies ExportedHandler<Env>;
