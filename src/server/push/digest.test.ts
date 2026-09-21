import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { pushDigestRuns, pushSubscriptions } from "../db/schema";
import type { AppDb } from "../db/types";
import { ingest } from "../queries/ingest";
import { getPushSubscription, savePushSubscription } from "../queries/push-subscriptions";
import { HANAZAWA, payload, rawWork, setupDb, UEDA } from "../queries/test-fixtures";
import { planDigest, runDigest } from "./digest";
import type { PushMessage } from "./message";
import type { PushTarget, SendOutcome } from "./send";

/** 2026-09-25 (金) 18:00 JST。この週の発売日の範囲は 09-19 〜 09-25 */
const FRIDAY = "2026-09-25T09:00:00.000Z";
/** 前の週の予定時刻。作品の取り込みはこの時刻に行い、初回クロールの基準にする */
const LAST_WEEK = "2026-09-18T09:00:00.000Z";

async function ingestWork(
  db: AppDb,
  actor: { id: string; canonicalName: string },
  storeProductId: string,
  overrides: Partial<Parameters<typeof rawWork>[0]> = {},
  at: string = LAST_WEEK,
) {
  await ingest(
    db,
    payload({
      runId: `run-${storeProductId}`,
      voiceActorId: actor.id,
      works: [rawWork({ storeProductId, creditedNames: [actor.canonicalName], ...overrides })],
    }),
    at,
  );
}

async function subscribe(
  db: AppDb,
  endpoint: string,
  actorIds: string[],
  locale: "ja" | "en" = "ja",
) {
  return savePushSubscription(
    db,
    { endpoint, p256dh: "p256dh", auth: "auth", locale, voiceActorIds: actorIds },
    LAST_WEEK,
  );
}

/** push service の代わり。endpoint ごとに結果を決め、送った内容を控える */
function fakeSender(outcomes: Record<string, SendOutcome> = {}) {
  const sent: Array<{ target: PushTarget; message: PushMessage }> = [];
  const send = vi.fn(async (target: PushTarget, message: PushMessage): Promise<SendOutcome> => {
    sent.push({ target, message });
    return outcomes[target.endpoint] ?? { kind: "sent" };
  });
  return { send, sent };
}

async function subscriptionRow(db: AppDb, id: number) {
  const [row] = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, id));
  return row;
}

describe("planDigest", () => {
  it("追う声優にその週の新作がある購読だけを対象にし、本文は購読の言語で組む", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    await ingestWork(db, UEDA, "RJ1", { releaseDate: "2026-09-20" });
    const ueda = await subscribe(db, "https://push.example/ueda", [UEDA.id], "en");
    const hanazawa = await subscribe(db, "https://push.example/hanazawa", [HANAZAWA.id]);

    const plan = await planDigest(db, { now: FRIDAY });

    expect(plan.targets.map((target) => target.subscription.id)).toEqual([ueda.id]);
    expect(plan.targets[0]?.message).toEqual({
      title: "1 new audio work",
      body: "New from 上田麗奈",
      url: "/following",
    });
    expect(plan.skipped.map((subscription) => subscription.id)).toEqual([hanazawa.id]);
  });

  it("範囲の外の発売日と R18 は数えない", async () => {
    const db = await setupDb([UEDA]);
    await ingestWork(db, UEDA, "RJ-before", { releaseDate: "2026-09-18" });
    await ingestWork(db, UEDA, "RJ-future", { releaseDate: "2026-09-26" });
    await ingestWork(db, UEDA, "RJ-adult", { releaseDate: "2026-09-20", ageRating: "r18" });
    await subscribe(db, "https://push.example/ueda", [UEDA.id]);

    const plan = await planDigest(db, { now: FRIDAY });

    expect(plan.targets).toEqual([]);
    expect(plan.skipped).toHaveLength(1);
  });

  it("範囲の両端 (前の金曜の翌日と、この金曜) の発売日は数える", async () => {
    const db = await setupDb([UEDA]);
    await ingestWork(db, UEDA, "RJ-first", { releaseDate: "2026-09-19" });
    await ingestWork(db, UEDA, "RJ-last", { releaseDate: "2026-09-25" });
    await subscribe(db, "https://push.example/ueda", [UEDA.id]);

    const plan = await planDigest(db, { now: FRIDAY });

    expect(plan.targets[0]?.works.map((work) => work.id).sort()).toEqual([
      "dlsite:RJ-first",
      "dlsite:RJ-last",
    ]);
  });

  /** ストアに載るのも日次の取り込みも発売日より遅れることがある。締めの後に入った作品を次の週で拾う */
  it("発売日が前の週でも、この週に初めて見つかった作品は数える", async () => {
    const db = await setupDb([UEDA]);
    // 初回クロールは前の週。その後、発売日 09-18 (前の週の金曜) の作品が今週見つかった
    await ingestWork(db, UEDA, "RJ-old", { releaseDate: "2026-08-01" }, LAST_WEEK);
    await ingestWork(
      db,
      UEDA,
      "RJ-late",
      { releaseDate: "2026-09-18" },
      "2026-09-22T00:00:00.000Z",
    );
    // 発売日が遡りの幅より前なら、今週見つかっても数えない
    await ingestWork(
      db,
      UEDA,
      "RJ-ancient",
      { releaseDate: "2026-08-01" },
      "2026-09-22T00:00:00.000Z",
    );
    await subscribe(db, "https://push.example/ueda", [UEDA.id]);

    const plan = await planDigest(db, { now: FRIDAY });

    expect(plan.targets[0]?.works.map((work) => work.id)).toEqual(["dlsite:RJ-late"]);
  });

  /** 発売日の無い作品は、その声優の初回クロールより後に見つかった分だけ */
  it("発売日の無い作品は、初回クロールより後にその週に見つかったものだけ数える", async () => {
    const db = await setupDb([UEDA]);
    // 初回クロール (前の週の予定時刻) で見つかった作品は新着ではない
    await ingestWork(db, UEDA, "RJ-initial", { releaseDate: undefined }, LAST_WEEK);
    // その後、今週見つかった作品は新着
    await ingestWork(db, UEDA, "RJ-found", { releaseDate: undefined }, "2026-09-22T00:00:00.000Z");
    await subscribe(db, "https://push.example/ueda", [UEDA.id]);

    const plan = await planDigest(db, { now: FRIDAY });

    expect(plan.targets[0]?.works.map((work) => work.id)).toEqual(["dlsite:RJ-found"]);
  });

  it("同じ作品に複数の追う声優が出ていても 1 件と数え、名前は並べる", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    await ingest(
      db,
      payload({
        runId: "run-duet",
        voiceActorId: UEDA.id,
        works: [
          rawWork({
            storeProductId: "RJ-duet",
            releaseDate: "2026-09-20",
            creditedNames: [UEDA.canonicalName, HANAZAWA.canonicalName],
          }),
        ],
      }),
      LAST_WEEK,
    );
    await subscribe(db, "https://push.example/both", [UEDA.id, HANAZAWA.id]);

    const plan = await planDigest(db, { now: FRIDAY });

    expect(plan.targets[0]?.works).toHaveLength(1);
    expect(plan.targets[0]?.message.title).toBe("新作の音声作品 1 件");
    expect(plan.targets[0]?.message.body).toContain("花澤香菜");
    expect(plan.targets[0]?.message.body).toContain("上田麗奈");
  });

  it("購読が無ければ何も無い", async () => {
    const db = await setupDb([UEDA]);
    const plan = await planDigest(db, { now: FRIDAY });
    expect(plan).toMatchObject({ targets: [], skipped: [], lastId: null });
  });
});

describe("runDigest", () => {
  it("新作がある購読に送り、無い購読には送らず、どちらもこの週は済みになる", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    await ingestWork(db, UEDA, "RJ1", { releaseDate: "2026-09-20" });
    const ueda = await subscribe(db, "https://push.example/ueda", [UEDA.id]);
    const hanazawa = await subscribe(db, "https://push.example/hanazawa", [HANAZAWA.id]);
    const { send, sent } = fakeSender();

    const result = await runDigest(db, { now: FRIDAY, send, log: () => {} });

    expect(sent.map((entry) => entry.target.endpoint)).toEqual(["https://push.example/ueda"]);
    expect(result).toMatchObject({
      scheduledAt: FRIDAY,
      subscriptionCount: 1,
      sentCount: 1,
      expiredCount: 0,
      failedCount: 0,
      exhausted: true,
    });
    expect(await subscriptionRow(db, ueda.id)).toMatchObject({
      lastDigestScheduledAt: FRIDAY,
      lastAttemptedAt: FRIDAY,
    });
    expect(await subscriptionRow(db, hanazawa.id)).toMatchObject({
      lastDigestScheduledAt: FRIDAY,
      lastAttemptedAt: null,
    });
  });

  it("同じ週にもう一度起動しても 2 通目は送らない", async () => {
    const db = await setupDb([UEDA]);
    await ingestWork(db, UEDA, "RJ1", { releaseDate: "2026-09-20" });
    await subscribe(db, "https://push.example/ueda", [UEDA.id]);
    const { send } = fakeSender();
    await runDigest(db, { now: FRIDAY, send, log: () => {} });

    const second = await runDigest(db, { now: "2026-09-25T09:10:00.000Z", send, log: () => {} });

    expect(send).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ subscriptionCount: 0, sentCount: 0, exhausted: true });
  });

  it("次の週の起動では改めて送る", async () => {
    const db = await setupDb([UEDA]);
    await ingestWork(db, UEDA, "RJ1", { releaseDate: "2026-09-20" });
    await ingestWork(db, UEDA, "RJ2", { releaseDate: "2026-09-30" });
    await subscribe(db, "https://push.example/ueda", [UEDA.id]);
    const { send } = fakeSender();
    await runDigest(db, { now: FRIDAY, send, log: () => {} });

    await runDigest(db, { now: "2026-10-02T09:00:00.000Z", send, log: () => {} });

    expect(send).toHaveBeenCalledTimes(2);
  });

  it("失効 (404 / 410) が返った購読は追う声優の対ごと消える", async () => {
    const db = await setupDb([UEDA]);
    await ingestWork(db, UEDA, "RJ1", { releaseDate: "2026-09-20" });
    const gone = await subscribe(db, "https://push.example/gone", [UEDA.id]);
    const { send } = fakeSender({ "https://push.example/gone": { kind: "expired", status: 410 } });

    const result = await runDigest(db, { now: FRIDAY, send, log: () => {} });

    expect(result).toMatchObject({ expiredCount: 1, sentCount: 0 });
    expect(await subscriptionRow(db, gone.id)).toBeUndefined();
    expect(await getPushSubscription(db, gone.endpoint)).toBeUndefined();
  });

  it("一時的な失敗は購読を残して試みた日時だけ書き、次の起動で送り直す", async () => {
    const db = await setupDb([UEDA]);
    await ingestWork(db, UEDA, "RJ1", { releaseDate: "2026-09-20" });
    const flaky = await subscribe(db, "https://push.example/flaky", [UEDA.id]);
    const failing = fakeSender({
      "https://push.example/flaky": { kind: "failed", permanent: false, status: 500 },
    });

    const first = await runDigest(db, { now: FRIDAY, send: failing.send, log: () => {} });

    expect(first).toMatchObject({ failedCount: 1, sentCount: 0 });
    expect(await subscriptionRow(db, flaky.id)).toMatchObject({
      lastDigestScheduledAt: null,
      lastAttemptedAt: FRIDAY,
    });

    const retry = fakeSender();
    const second = await runDigest(db, {
      now: "2026-09-25T09:10:00.000Z",
      send: retry.send,
      log: () => {},
    });

    expect(second).toMatchObject({ sentCount: 1 });
    expect(await subscriptionRow(db, flaky.id)).toMatchObject({ lastDigestScheduledAt: FRIDAY });
  });

  /** 送っても通らない購読が毎回の起動で送信枠を先に食うと、後ろの購読に届かない */
  it("恒久的な失敗はこの週は済みにし、同じ週の次の起動では送り直さない", async () => {
    const db = await setupDb([UEDA]);
    await ingestWork(db, UEDA, "RJ1", { releaseDate: "2026-09-20" });
    const rejected = await subscribe(db, "https://push.example/rejected", [UEDA.id]);
    const { send } = fakeSender({
      "https://push.example/rejected": { kind: "failed", permanent: true, status: 403 },
    });

    const first = await runDigest(db, { now: FRIDAY, send, log: () => {} });
    expect(first).toMatchObject({ failedCount: 1, sentCount: 0 });
    expect(await subscriptionRow(db, rejected.id)).toMatchObject({
      lastDigestScheduledAt: FRIDAY,
      lastAttemptedAt: FRIDAY,
    });

    await runDigest(db, { now: "2026-09-25T09:10:00.000Z", send, log: () => {} });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("途中で例外が出ても、そこまでの件数と終了日時を走行の記録に書いてから投げる", async () => {
    const db = await setupDb([UEDA]);
    await ingestWork(db, UEDA, "RJ1", { releaseDate: "2026-09-20" });
    await subscribe(db, "https://push.example/ueda", [UEDA.id]);
    const send = vi.fn(async () => {
      throw new Error("D1 が落ちた");
    });

    await expect(
      runDigest(db, { now: FRIDAY, send, log: () => {}, clock: () => FRIDAY }),
    ).rejects.toThrow("D1 が落ちた");

    const runs = await db.select().from(pushDigestRuns);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ finishedAt: FRIDAY, subscriptionCount: 1, sentCount: 0 });
  });

  /** 1 回の起動で送る数を切り、残りは次の起動に持ち越す */
  it("上限を超えた分は次の起動に持ち越し、合わせて 1 通ずつになる", async () => {
    const db = await setupDb([UEDA]);
    await ingestWork(db, UEDA, "RJ1", { releaseDate: "2026-09-20" });
    for (const name of ["a", "b", "c"]) {
      await subscribe(db, `https://push.example/${name}`, [UEDA.id]);
    }
    const { send, sent } = fakeSender();

    const first = await runDigest(db, { now: FRIDAY, send, sendLimit: 2, log: () => {} });
    expect(first).toMatchObject({ subscriptionCount: 2, sentCount: 2, exhausted: false });

    const second = await runDigest(db, {
      now: "2026-09-25T09:10:00.000Z",
      send,
      sendLimit: 2,
      log: () => {},
    });
    expect(second).toMatchObject({ subscriptionCount: 1, sentCount: 1 });

    expect(sent.map((entry) => entry.target.endpoint).sort()).toEqual([
      "https://push.example/a",
      "https://push.example/b",
      "https://push.example/c",
    ]);
  });

  it("走行ごとに記録が 1 行残り、件数と予定時刻が入る", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    await ingestWork(db, UEDA, "RJ1", { releaseDate: "2026-09-20" });
    await subscribe(db, "https://push.example/ueda", [UEDA.id]);
    await subscribe(db, "https://push.example/gone", [UEDA.id]);
    await subscribe(db, "https://push.example/hanazawa", [HANAZAWA.id]);
    const { send } = fakeSender({ "https://push.example/gone": { kind: "expired", status: 404 } });

    const finished = "2026-09-25T09:00:03.000Z";
    const result = await runDigest(db, { now: FRIDAY, send, log: () => {}, clock: () => finished });

    const runs = await db.select().from(pushDigestRuns);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: result.runId,
      digestScheduledAt: FRIDAY,
      startedAt: FRIDAY,
      finishedAt: finished,
      subscriptionCount: 2,
      sentCount: 1,
      expiredCount: 1,
      failedCount: 0,
    });
  });

  it("鍵が無ければ何も送らず、記録も残さず、ログに出す", async () => {
    const db = await setupDb([UEDA]);
    await ingestWork(db, UEDA, "RJ1", { releaseDate: "2026-09-20" });
    await subscribe(db, "https://push.example/ueda", [UEDA.id]);
    const log = vi.fn();

    const result = await runDigest(db, { now: FRIDAY, send: null, log });

    expect(result).toMatchObject({ runId: null, sentCount: 0 });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("未設定"));
    expect(await db.select().from(pushDigestRuns)).toEqual([]);
  });
});
