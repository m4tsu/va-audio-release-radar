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

/** 札 1 枚。列を足したときに書き写しがずれないよう、表の形から取る */
export type CrawlLease = typeof crawlLeases.$inferSelect;

/**
 * 札を取る。取れたら true。
 *
 * 取れるのは「まだ誰も持っていない」「期限が切れている」「自分が持っている」のどれか。
 * 自分が持っているときに取れるのは、同じ走行が取り直しても失敗しないようにするため (冪等)。
 *
 * **`holder` は走行ごとに一意な値を渡す。** 同じ文字列を 2 つの走行が使うと、互いを
 * 「自分の札」とみなして両方が取れてしまう。ジョブ名のような使い回される値をそのまま渡さない。
 * **`expiresAt` と `now` は `toISOString()` の形で渡す。** 期限の比較は文字列の大小で行うので、
 * 形が揃っていないと順序が壊れる
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
 * 切れた札を延ばせてしまうと、その間に他の走行が取った札を奪うことになる。
 * `acquireLease` が「期限ちょうど」を空きとみなすので、こちらは期限ちょうどを切れた側に入れる
 * (両方が取れる瞬間を作らないため)
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

/** 今ある札の一覧。誰が何を持っているかを読む唯一の経路 */
export async function listLeases(db: AppDb): Promise<CrawlLease[]> {
  return db.select().from(crawlLeases).orderBy(crawlLeases.key);
}
