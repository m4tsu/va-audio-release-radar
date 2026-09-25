import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { anilistIngestPayloadSchema } from "@/contract";
import { requireBearer } from "@/server/auth";
import { dataChangedHeaders } from "@/server/cache-policy";
import { getDb } from "@/server/db/client";
import { requireIngestProtocolVersion } from "@/server/protocol";
import { ingestAniList } from "@/server/queries/anilist";
import { summarizeIssues } from "@/server/validation";

/**
 * AniList の取得 1 回ぶんの取り込み。声優・アニメ・出演をまとめて受け取り、台帳に足す。
 *
 * 声優の ID と slug をここで決めるのは、slug が URL に出て衝突の解決に今ある全員を見る必要が
 * あるため。送り手は AniList が言っている値だけを持つ。
 * ingest / actors と同じ Bearer トークンを使う (どれもクローラー側の運用操作のため)
 */

/** 1 回の POST で受け取る本文の上限。12 シーズンぶんの作品と出演者を 1 度に流す */
const MAX_BODY_BYTES = 20 * 1024 * 1024;

export const Route = createFileRoute("/api/admin/anilist")({
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

        // 全体の検証より先に版を見る。版が上がる変更は中身の形を変えるので、
        // 先に zod へ通すと「版がずれている」が「payload が不正」に化けて読めなくなる
        const mismatched = requireIngestProtocolVersion(body);
        if (mismatched) return mismatched;

        const parsed = anilistIngestPayloadSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json(
            { error: "payload が不正", issues: summarizeIssues(parsed.error) },
            { status: 400 },
          );
        }

        const result = await ingestAniList(getDb(), parsed.data, new Date().toISOString());
        return Response.json(result, { headers: dataChangedHeaders(true) });
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
      { status: 413 },
    );
  }
  return null;
}
