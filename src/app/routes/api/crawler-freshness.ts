import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/server/db/client";
import { loadCrawlerFreshness } from "@/server/queries/freshness";

/**
 * 取り込みの鮮度。ストアごとに「直近の一定時間内に成功した取り込みがあるか」を返す。
 *
 * `/api/health` と分けてあるのは、あちらが DB に触らない契約で、デプロイ後の疎通と
 * E2E の起動待ちに使われているため。DB が落ちてもあちらは 200 を返す必要がある。
 *
 * **すべてのストアが新しければ 200、1 つでも古ければ 503 を返す。**
 * 外形監視は本文を読まず HTTP の状態だけを見れば足りる (`README.md` の「外形監視」)。
 * 認証を付けないのは、外形監視のサービスに秘匿値を預けずに済ませるため。
 * 出るのはクロールの時刻だけで、利用者の情報は含まない
 */
export const Route = createFileRoute("/api/crawler-freshness")({
  server: {
    handlers: {
      GET: async () => {
        const freshness = await loadCrawlerFreshness(getDb(), new Date().toISOString());
        return Response.json(freshness, {
          status: freshness.ok ? 200 : 503,
          // 監視が古い応答を掴まないようにする
          headers: { "cache-control": "no-store" },
        });
      },
    },
  },
});
