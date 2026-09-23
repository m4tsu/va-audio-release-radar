import { and, eq, inArray, isNull, max } from "drizzle-orm";
import { STORE_SLUGS, type StoreSlug } from "@/domain/types";
import { crawlRuns } from "../db/schema";
import type { AppDb } from "../db/types";

/**
 * 取り込みが止まったと見なすまでの時間。
 *
 * 日次の走行は 1 日 1 回なので、**1 回落とすと次の予定時刻の約 6 時間後に鳴る**。
 * 24 時間ちょうどにしないのは、GitHub の定期実行が混雑で遅れることがあるため。
 * 猶予を増やすと気づくのが遅れ、減らすと遅れただけで鳴る
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
 * **数えるのは日次の走行 (声優に紐付かない = `voice_actor_id` が NULL) だけ。**
 * 声優起点は手で起動するものなので、1 回走らせただけで日次が止まっているのを覆い隠す。
 * 監視の目的は cron が動いていることの確認なので、その走行だけを見る
 */
export async function loadCrawlerFreshness(db: AppDb, now: string): Promise<CrawlerFreshness> {
  const rows = await db
    .select({
      storeSlug: crawlRuns.storeSlug,
      // 取り込みを受けた時刻。取得を始めた時刻 (started_at) は数時間前のことがある
      lastSuccessAt: max(crawlRuns.finishedAt),
    })
    .from(crawlRuns)
    .where(
      and(
        eq(crawlRuns.status, "ok"),
        // ストアを並べるのは `crawl_runs_store_actor_started_idx` (ストア, 声優) の索引で
        // 日次の走行だけを引くため。無いと声優起点の走行まで全件を読む
        inArray(crawlRuns.storeSlug, [...STORE_SLUGS]),
        isNull(crawlRuns.voiceActorId),
      ),
    )
    .groupBy(crawlRuns.storeSlug);

  const latest = new Map(rows.map((row) => [row.storeSlug, row.lastSuccessAt ?? undefined]));
  const checkedAtMs = Date.parse(now);

  // 対応ストアは全部並べる。1 度も走っていないストアが黙って消えると、
  // 「まだ始めていない」と「止まった」を取り違える
  const stores = STORE_SLUGS.map((storeSlug): StoreFreshness => {
    const lastSuccessAt = latest.get(storeSlug);
    if (lastSuccessAt === undefined) return { storeSlug, fresh: false };
    const ageHours = (checkedAtMs - Date.parse(lastSuccessAt)) / (60 * 60 * 1000);
    // 読めない時刻を経過時間として出さない。NaN は JSON で null になり、型と食い違う
    if (!Number.isFinite(ageHours)) return { storeSlug, lastSuccessAt, fresh: false };
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
