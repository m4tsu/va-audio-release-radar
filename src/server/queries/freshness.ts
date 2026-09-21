import { and, desc, eq, max } from "drizzle-orm";
import { STORE_SLUGS, type StoreSlug } from "@/domain/types";
import { crawlRuns } from "../db/schema";
import type { AppDb } from "../db/types";

/**
 * 取り込みが止まったと見なすまでの時間。
 *
 * 日次の走行は 1 日 1 回なので、1 回落としただけで鳴ると誤報が増える。
 * 2 回続けて落ちたら鳴る幅にしてある。これより長くすると「止まっている」に気づくのが遅れる
 */
export const STALE_AFTER_HOURS = 30;

export type StoreFreshness = {
  storeSlug: StoreSlug;
  /** 直近に成功した取り込みの時刻。1 度も成功していなければ undefined */
  lastSuccessAt?: string;
  /** そこから今までの経過時間 (時)。小数第 1 位まで。成功が無ければ undefined */
  ageHours?: number;
  /** `STALE_AFTER_HOURS` 以内に成功した取り込みがあるか。1 度も無ければ false */
  fresh: boolean;
};

export type CrawlerFreshness = {
  /** すべてのストアが新しいか。外形監視はこれだけを見れば足りる */
  ok: boolean;
  checkedAt: string;
  staleAfterHours: number;
  stores: StoreFreshness[];
};

/**
 * ストアごとの取り込みの鮮度。
 *
 * 「直近に成功した取り込みがあるか」だけを見る。件数の前回比は見ない。
 * 日次の走行は件数が日ごとに揺れるので、件数で判定すると誤報になる
 * (`docs/decisions/0007-daily-crawl-from-store-feeds.md` の「帰結」)。
 *
 * 走行の種類 (声優起点 / 新着一覧) は区別しない。どちらであれ成功した取り込みが
 * 新しければ、そのストアの経路は生きている
 */
export async function loadCrawlerFreshness(db: AppDb, now: string): Promise<CrawlerFreshness> {
  const rows = await db
    .select({
      storeSlug: crawlRuns.storeSlug,
      // 取り込みを受けた時刻。取得を始めた時刻 (started_at) は数時間前のことがある
      lastSuccessAt: max(crawlRuns.finishedAt),
    })
    .from(crawlRuns)
    .where(eq(crawlRuns.status, "ok"))
    .groupBy(crawlRuns.storeSlug);

  const latest = new Map(rows.map((row) => [row.storeSlug, row.lastSuccessAt ?? undefined]));
  const checkedAtMs = Date.parse(now);

  // 対応ストアは全部並べる。1 度も走っていないストアが黙って消えると、
  // 「まだ始めていない」と「止まった」を取り違える
  const stores = STORE_SLUGS.map((storeSlug): StoreFreshness => {
    const lastSuccessAt = latest.get(storeSlug);
    if (lastSuccessAt === undefined) return { storeSlug, fresh: false };
    const ageHours = (checkedAtMs - Date.parse(lastSuccessAt)) / (60 * 60 * 1000);
    return {
      storeSlug,
      lastSuccessAt,
      ageHours: Math.round(ageHours * 10) / 10,
      fresh: ageHours <= STALE_AFTER_HOURS,
    };
  });

  return {
    ok: stores.every((store) => store.fresh),
    checkedAt: now,
    staleAfterHours: STALE_AFTER_HOURS,
    stores,
  };
}

/**
 * 1 ストアの直近に成功した取り込みの時刻。管理画面の健全性が使う。
 * `loadCrawlerFreshness` と違い、呼び出し側が持っている run の一覧から決められないときだけ使う
 */
export async function lastSuccessAt(db: AppDb, storeSlug: StoreSlug): Promise<string | undefined> {
  const [row] = await db
    .select({ finishedAt: crawlRuns.finishedAt })
    .from(crawlRuns)
    .where(and(eq(crawlRuns.storeSlug, storeSlug), eq(crawlRuns.status, "ok")))
    .orderBy(desc(crawlRuns.finishedAt))
    .limit(1);
  return row?.finishedAt ?? undefined;
}
