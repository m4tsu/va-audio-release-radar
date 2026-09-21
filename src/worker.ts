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
  scheduled: (_controller, _env, ctx) => {
    // 起動の中で D1 と push service に出る。応答を返す相手が居ないので waitUntil で終わりまで待たせる
    ctx.waitUntil(
      import("@/server/push/scheduled").then(({ runScheduledDigest }) => runScheduledDigest()),
    );
  },
} satisfies ExportedHandler<Env>;
