import { createFileRoute } from "@tanstack/react-router";

/**
 * 稼働確認。画面を描かず JSON だけ返す server route。
 * デプロイ後の疎通と E2E の起動待ちに使うため、DB には触らない
 */
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: () => Response.json({ ok: true }),
    },
  },
});
