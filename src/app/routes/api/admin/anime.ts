import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireBearer } from "@/server/auth";
import { getDb } from "@/server/db/client";
import { animeSeedSchema, upsertAnime } from "@/server/queries/anime";
import { summarizeIssues } from "@/server/validation";

/**
 * アニメ導線のデータ投入。`crawler/anime.generated.json` をそのまま流し込む想定で、
 * ingest / actors と同じ Bearer トークンを使う (どれもクローラー側の運用操作のため)。
 *
 * 声優を先に投入しておくこと。DB に居ない声優を指す出演は取り込まずに数えて返す
 */

const requestSchema = z.array(animeSeedSchema).min(1);

/** 1 回の POST で受け取る本文の上限。ingest より大きいのは全作品を 1 度に流すため */
const MAX_BODY_BYTES = 20 * 1024 * 1024;

export const Route = createFileRoute("/api/admin/anime")({
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

        const parsed = requestSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json(
            { error: "anime が不正", issues: summarizeIssues(parsed.error) },
            { status: 400 },
          );
        }

        const result = await upsertAnime(getDb(), parsed.data, new Date().toISOString());
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
      { status: 413 },
    );
  }
  return null;
}
