import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Delisting, RecordDelistingsResponse } from "@/contract";
import type { StoreSlug } from "@/domain/types";
import { chunked } from "../db/chunked";
import { storeListings } from "../db/schema";
import type { AppDb } from "../db/types";

/**
 * 販売終了の記録。
 *
 * 声優起点の走行ではここを動かせない。ストアの検索結果には売っている作品しか出ないので、
 * 買えなくなった作品は検索から消え、詳細を引き直す機会そのものが無くなる
 * (2026-09-23 の測定、`docs/research/dlsite-on-sale-2026-09-23.md`)。
 * だから台帳が持っている商品 ID を起点に引き直し、その結果だけをここへ送る
 */

/**
 * 判定を台帳に書く。行は消さない。
 *
 * 取り下げの日時は最初に気づいたときのまま残す。引き直すたびに新しくすると、
 * いつから買えないのかが分からなくなる
 */
export async function recordDelistings(
  db: AppDb,
  items: readonly Delisting[],
  now: string = new Date().toISOString(),
): Promise<RecordDelistingsResponse> {
  const result: RecordDelistingsResponse = { delisted: 0, relisted: 0, unknown: 0 };
  if (items.length === 0) return result;

  const byStore = new Map<StoreSlug, Delisting[]>();
  for (const item of items) {
    const list = byStore.get(item.storeSlug) ?? [];
    list.push(item);
    byStore.set(item.storeSlug, list);
  }

  for (const [storeSlug, storeItems] of byStore) {
    const known = await knownProductIds(
      db,
      storeSlug,
      storeItems.map((item) => item.storeProductId),
    );
    const toDelist = storeItems
      .filter((item) => item.delisted && known.has(item.storeProductId))
      .map((item) => item.storeProductId);
    const toRelist = storeItems
      .filter((item) => !item.delisted && known.has(item.storeProductId))
      .map((item) => item.storeProductId);
    result.unknown += storeItems.filter((item) => !known.has(item.storeProductId)).length;

    for (const chunk of chunked(toDelist)) {
      const updated = await db
        .update(storeListings)
        .set({ delistedAt: now })
        .where(
          and(
            eq(storeListings.storeSlug, storeSlug),
            inArray(storeListings.storeProductId, chunk),
            // 既に取り下げてある行は触らない。最初に気づいた日時を残すため
            isNull(storeListings.delistedAt),
          ),
        )
        .returning({ id: storeListings.id });
      result.delisted += updated.length;
    }

    for (const chunk of chunked(toRelist)) {
      const updated = await db
        .update(storeListings)
        .set({ delistedAt: null })
        .where(
          and(
            eq(storeListings.storeSlug, storeSlug),
            inArray(storeListings.storeProductId, chunk),
            sql`${storeListings.delistedAt} is not null`,
          ),
        )
        .returning({ id: storeListings.id });
      result.relisted += updated.length;
    }
  }

  return result;
}

async function knownProductIds(
  db: AppDb,
  storeSlug: StoreSlug,
  productIds: readonly string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  for (const chunk of chunked([...new Set(productIds)])) {
    const rows = await db
      .select({ storeProductId: storeListings.storeProductId })
      .from(storeListings)
      .where(
        and(eq(storeListings.storeSlug, storeSlug), inArray(storeListings.storeProductId, chunk)),
      );
    for (const row of rows) found.add(row.storeProductId);
  }
  return found;
}
