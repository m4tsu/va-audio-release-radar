import { count, eq } from "drizzle-orm";
import type { StoreSlug } from "@/domain/types";
import { chunked } from "../db/chunked";
import { screenedStoreProducts } from "../db/schema";
import type { AppDb } from "../db/types";

/**
 * 1 回の INSERT に並べる行数。1 行が 3 つの値を bind するので、
 * D1 の bound parameter 上限 100 (`../db/chunked.ts`) に収まる値にする
 */
const SCREENED_INSERT_CHUNK_SIZE = 30;

/**
 * 「対象声優が 1 人も出ていない」と判断した商品を覚える。
 *
 * 日次の走行が 2 度目以降の詳細取得を省くためだけのもの。作品の情報は持たない
 * (`src/server/db/schema.ts` の `screenedStoreProducts`)
 */
export async function recordScreened(
  db: AppDb,
  storeSlug: StoreSlug,
  storeProductIds: readonly string[],
  now: string,
): Promise<void> {
  if (storeProductIds.length === 0) return;

  // 同じ商品を 2 度見ることがある (辞書を捨てた後の引き直し)。時刻だけ新しくする。
  // 1 行が 3 つの値を bind するので、D1 の上限 100 に収まる件数で切る
  for (const batch of chunked([...new Set(storeProductIds)], SCREENED_INSERT_CHUNK_SIZE)) {
    await db
      .insert(screenedStoreProducts)
      .values(batch.map((storeProductId) => ({ storeSlug, storeProductId, screenedAt: now })))
      .onConflictDoUpdate({
        target: [screenedStoreProducts.storeSlug, screenedStoreProducts.storeProductId],
        set: { screenedAt: now },
      });
  }
}

/** そのストアで「対象外」と判断済みの商品 ID */
export async function screenedStoreProductIds(db: AppDb, storeSlug: StoreSlug): Promise<string[]> {
  const rows = await db
    .select({ storeProductId: screenedStoreProducts.storeProductId })
    .from(screenedStoreProducts)
    .where(eq(screenedStoreProducts.storeSlug, storeSlug));
  return rows.map((row) => row.storeProductId);
}

/**
 * 判断をすべて捨てる。
 *
 * 「対象声優が 1 人も出ていない」は声優の辞書に対する判断なので、辞書に名前が増えれば答えも変わる。
 * 捨てないと、新しく追い始めた声優の既存作品が新着一覧から永久に入らない。
 *
 * 捨てるのは全件。どの作品がどの表記で落ちたかを残していないので、影響のある行だけを
 * 選べない (表記を残さない判断は `docs/decisions/0007-daily-crawl-from-store-feeds.md` の「帰結」)。
 * 次の日次は「一覧に出た作品のうち保存済みでないもの」を引き直す。保存済みの作品は
 * `store_listings` に残っていて既知のままなので、そこは増えない
 */
export async function clearScreened(db: AppDb): Promise<number> {
  // 件数は先に数える。`returning` で全行を持ち帰ると、消す件数に比例して読み込みが増える
  const [counted] = await db.select({ count: count() }).from(screenedStoreProducts);
  await db.delete(screenedStoreProducts);
  return counted?.count ?? 0;
}
