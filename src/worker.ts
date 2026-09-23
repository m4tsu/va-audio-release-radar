import handler from "@tanstack/react-start/server-entry";
import { applyCacheDecision, decideCache } from "@/server/cache-policy";

/**
 * Worker の入口。HTTP は TanStack Start の既定の入口に渡し、応答にキャッシュの扱いを付けてから返す。
 * cron (`scheduled`) もここで受ける。
 *
 * 既定の入口 (`@tanstack/react-start/server-entry`) は `fetch` しか持たず、cron の起動を受け取れない。
 * `wrangler.jsonc` の `main` はこのファイルを指す。ダイジェストの段取りは `@/server/push/digest`、
 * キャッシュの判定は `@/server/cache-policy`
 */

const start = handler as unknown as {
  fetch: (...args: unknown[]) => Promise<Response> | Response;
};

export default {
  fetch: async (request, env, ctx) => {
    const response = await start.fetch(request, env, ctx);
    const decision = decideCache(request, response);
    // 消すのは応答を返した後でよい。待たせると取り込みの 1 回ごとに往復が 1 つ増える
    if (decision.purge) ctx.waitUntil(purgeCache(ctx));
    return applyCacheDecision(response, decision);
  },
  scheduled: async () => {
    // 返した Promise が終わるまで起動は続く。途中の例外はそのまま起動の失敗として記録される
    // (waitUntil に渡すと、失敗してもこの起動は成功と数えられる)
    const { runScheduledDigest } = await import("@/server/push/scheduled");
    await runScheduledDigest();
  },
} satisfies ExportedHandler<Env>;

/**
 * キャッシュをすべて消す。キャッシュに載るのはどれもデータから作った応答なので、分けて消す意味が無い。
 * 回数の上限に当たって消せなかったときは記録だけ残す。古さは寿命 (`CDN_CACHE_CONTROL`) で止まる
 */
async function purgeCache(ctx: ExecutionContext): Promise<void> {
  // Workers Cache が無効な環境 (手元の dev) では `ctx.cache` が無い
  if (ctx.cache === undefined) return;
  const result = await ctx.cache.purge({ purgeEverything: true });
  if (!result.success) console.warn("キャッシュを消せなかった", result.errors);
}
