import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { ingestPayloadSchema } from "@/domain/types";
import { requireBearer } from "@/server/auth";
import { getDb } from "@/server/db/client";
import { requireIngestProtocolVersion } from "@/server/protocol";
import { ingest } from "@/server/queries/ingest";
import { summarizeIssues } from "@/server/validation";

/**
 * クローラーからの取り込み。DB を触るコードを Worker 側 1 箇所に集約するため、
 * クローラーは直接 D1 に書かずここへ JSON を POST する。
 * GitHub Actions からもローカルの `vite dev` からも同じ経路で流せる
 */

/** 1 回の POST で受け取る本文の上限。声優 1 人ぶんの 1 ページ (30 件) なら遥かに収まる */
const MAX_BODY_BYTES = 5 * 1024 * 1024;

export const Route = createFileRoute("/api/admin/ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = requireBearer(request, env.INGEST_TOKEN);
        if (unauthorized) return unauthorized;

        const tooLarge = checkBodySize(request);
        if (tooLarge) return tooLarge;

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "JSON として読めない本文" }, { status: 400 });
        }

        // 全体の検証より先に版を見る。版が上がる変更は works の形を変えるので、
        // 先に zod へ通すと「版がずれている」が「works が不正」に化けて読めなくなる
        const mismatched = requireIngestProtocolVersion(body);
        if (mismatched) return mismatched;

        const parsed = ingestPayloadSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json(
            { error: "payload が不正", issues: summarizeIssues(parsed.error) },
            { status: 400 },
          );
        }

        const result = await ingest(getDb(), parsed.data, new Date().toISOString());
        return Response.json(result);
      },
    },
  },
});

/**
 * Content-Length での事前判定。ヘッダが無い (chunked) 場合は素通しになるが、
 * Workers 側にも本文サイズの上限があるので入口の目安として置く
 */
function checkBodySize(request: Request): Response | null {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    return Response.json(
      { error: `本文が大きすぎる (上限 ${MAX_BODY_BYTES} バイト)` },
      {
        status: 413,
      },
    );
  }
  return null;
}
