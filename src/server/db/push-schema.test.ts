import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { NOW, setupDb, UEDA } from "../queries/test-fixtures";
import { pushDigestRuns, pushSubscriptionActors, pushSubscriptions } from "./schema";
import type { AppDb } from "./types";

/**
 * Web Push の購読まわりの表が、マイグレーション SQL の制約どおりに振る舞うことを確かめる。
 *
 * 購読を読み書きする関数はまだ無い (画面は別 issue) ので、drizzle で直接行を入れて制約を見る。
 * 制約は `migrations/*.sql` に書かれたものが本番に当たるので、スキーマの定義ではなく
 * 適用後の DB で確かめる
 */

async function insertSubscription(db: AppDb, endpoint = "https://push.example/sub/1") {
  const [row] = await db
    .insert(pushSubscriptions)
    .values({
      endpoint,
      p256dh: "p256dh",
      auth: "auth",
      locale: "ja",
      createdAt: NOW,
      updatedAt: NOW,
    })
    .returning();
  if (!row) throw new Error("購読を入れられなかった");
  return row;
}

describe("push_subscriptions", () => {
  it("同じ endpoint は 2 行入らない", async () => {
    const db = await setupDb();
    await insertSubscription(db);

    await expect(insertSubscription(db)).rejects.toThrow();
    expect(await db.select().from(pushSubscriptions)).toHaveLength(1);
  });

  it("送信の記録は登録時には空", async () => {
    const db = await setupDb();

    const row = await insertSubscription(db);

    expect(row.lastAttemptedAt).toBeNull();
    expect(row.lastDigestScheduledAt).toBeNull();
  });
});

describe("push_subscription_actors", () => {
  it("同じ購読に同じ声優は 1 行だけ入る", async () => {
    const db = await setupDb();
    const subscription = await insertSubscription(db);
    const pair = { subscriptionId: subscription.id, voiceActorId: UEDA.id };
    await db.insert(pushSubscriptionActors).values(pair);

    await expect(db.insert(pushSubscriptionActors).values(pair)).rejects.toThrow();
    expect(await db.select().from(pushSubscriptionActors)).toHaveLength(1);
  });

  it("存在しない声優は入らない", async () => {
    const db = await setupDb();
    const subscription = await insertSubscription(db);

    await expect(
      db
        .insert(pushSubscriptionActors)
        .values({ subscriptionId: subscription.id, voiceActorId: "va_missing" }),
    ).rejects.toThrow();
  });

  /** 失効した購読を消すとき、対を別に消さなくてよいことを確かめる */
  it("購読を消すと追う声優の対も消える", async () => {
    const db = await setupDb();
    const subscription = await insertSubscription(db);
    await db
      .insert(pushSubscriptionActors)
      .values({ subscriptionId: subscription.id, voiceActorId: UEDA.id });

    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscription.id));

    expect(await db.select().from(pushSubscriptionActors)).toEqual([]);
  });
});

describe("push_digest_runs", () => {
  /** 走行の始めに書く行。件数はまだ無く、終了日時は終わりに埋める */
  it("始めた時点の行は件数 0 で終了日時が空", async () => {
    const db = await setupDb();

    const [row] = await db
      .insert(pushDigestRuns)
      .values({ digestScheduledAt: NOW, startedAt: NOW })
      .returning();

    expect(row).toMatchObject({
      finishedAt: null,
      subscriptionCount: 0,
      sentCount: 0,
      expiredCount: 0,
      failedCount: 0,
    });
  });
});
