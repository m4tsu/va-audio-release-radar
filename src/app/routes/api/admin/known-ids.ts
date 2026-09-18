import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { STORE_SLUGS, type StoreSlug } from "@/domain/types";
import { requireBearer } from "@/server/auth";
import { getDb } from "@/server/db/client";
import { knownStoreProductIds } from "@/server/queries/works";

/**
 * クローラーが「DB に既にある商品 ID」を引くための読み取り専用エンドポイント。
 *
 * DLsite は作品詳細 (`product.json`) を 1 件ずつしか引けず間隔も要るので、既知の作品を
 * 毎回引き直すと 1 声優あたり分単位で無駄になる。クローラーはこれを使って新規 ID だけに絞る。
 * ingest と同じ Bearer トークンを使う (どちらもクローラー側の運用操作のため)
 */

export const Route = createFileRoute("/api/admin/known-ids")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const unauthorized = requireBearer(request, env.INGEST_TOKEN);
        if (unauthorized) return unauthorized;

        const store = new URL(request.url).searchParams.get("store");
        if (!isStoreSlug(store)) {
          return Response.json(
            { error: `store は ${STORE_SLUGS.join(" か ")} を指定する` },
            { status: 400 },
          );
        }

        const ids = await knownStoreProductIds(getDb(), store);
        return Response.json(ids);
      },
    },
  },
});

function isStoreSlug(value: string | null): value is StoreSlug {
  return value !== null && (STORE_SLUGS as readonly string[]).includes(value);
}
