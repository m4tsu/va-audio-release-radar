import { and, eq, gt, lte, or } from "drizzle-orm";
import { crawlLeases } from "../db/schema";
import type { AppDb } from "../db/types";

/**
 * ホストごとの実行権。
 *
 * 取る・延ばす・返すのどれも **1 文で行う**。D1 に対話的トランザクションが無いので、
 * 「読んでから書く」形にすると 2 つの走行が同時に読んで両方が取れてしまう。
 * 条件は SQL の WHERE に置き、書けたかどうかを `RETURNING` の行数で判定する。
 *
 * 期限を持つのは、走行が異常終了したときに札が残り続けないようにするため。
 * 長い走行は期限が切れる前に延ばす (`extendLease`)
 */

/** 札 1 枚 */
export type CrawlLease = {
  key: string;
  holder: string;
  acquiredAt: string;
  expiresAt: string;
};

/**
 * 札を取る。取れたら true。
 *
 * 取れるのは「まだ誰も持っていない」「期限が切れている」「自分が持っている」のどれか。
 * 自分が持っているときに取れるのは、同じ走行が取り直しても失敗しないようにするため (冪等)
 */
export async function acquireLease(
  db: AppDb,
  input: { key: string; holder: string; expiresAt: string },
  now: string = new Date().toISOString(),
): Promise<boolean> {
  const rows = await db
    .insert(crawlLeases)
    .values({
      key: input.key,
      holder: input.holder,
      acquiredAt: now,
      expiresAt: input.expiresAt,
    })
    .onConflictDoUpdate({
      target: crawlLeases.key,
      set: { holder: input.holder, acquiredAt: now, expiresAt: input.expiresAt },
      // 既に誰かが持っていて期限内なら書き換えない。自分の札なら取り直せる
      setWhere: or(lte(crawlLeases.expiresAt, now), eq(crawlLeases.holder, input.holder)),
    })
    .returning({ key: crawlLeases.key });

  return rows.length > 0;
}

/**
 * 札の期限を延ばす。延ばせたら true。
 *
 * 持ち主が違う、または既に期限が切れている札は延ばせない。
 * 切れた札を延ばせてしまうと、その間に他の走行が取った札を奪うことになる
 */
export async function extendLease(
  db: AppDb,
  input: { key: string; holder: string; expiresAt: string },
  now: string = new Date().toISOString(),
): Promise<boolean> {
  const rows = await db
    .update(crawlLeases)
    .set({ expiresAt: input.expiresAt })
    .where(
      and(
        eq(crawlLeases.key, input.key),
        eq(crawlLeases.holder, input.holder),
        gt(crawlLeases.expiresAt, now),
      ),
    )
    .returning({ key: crawlLeases.key });

  return rows.length > 0;
}

/** 札を返す。返せたら true。持ち主が違えば何もしない */
export async function releaseLease(
  db: AppDb,
  input: { key: string; holder: string },
): Promise<boolean> {
  const rows = await db
    .delete(crawlLeases)
    .where(and(eq(crawlLeases.key, input.key), eq(crawlLeases.holder, input.holder)))
    .returning({ key: crawlLeases.key });

  return rows.length > 0;
}

/** 今ある札の一覧。管理画面と、走行が詰まったときの調査に使う */
export async function listLeases(db: AppDb): Promise<CrawlLease[]> {
  return db.select().from(crawlLeases).orderBy(crawlLeases.key);
}

/** 今から `ttlMs` 後の時刻。呼び出し側が時刻の組み立てを重ねて書かずに済むようにする */
export function leaseExpiry(ttlMs: number, now: string = new Date().toISOString()): string {
  return new Date(Date.parse(now) + ttlMs).toISOString();
}
