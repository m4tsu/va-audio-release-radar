import { describe, expect, it } from "vitest";
import { createMigratedTestDb } from "../db/test-db";
import { acquireLease, extendLease, leaseExpiry, listLeases, releaseLease } from "./leases";

/** 基準時刻。期限の前後をこの時点から組み立てて結果を固定する */
const NOW = "2026-09-18T00:00:00.000Z";
const MINUTE_MS = 60 * 1000;

function at(offsetMs: number): string {
  return new Date(Date.parse(NOW) + offsetMs).toISOString();
}

describe("acquireLease", () => {
  it("空いていれば取れる", async () => {
    const db = await createMigratedTestDb();

    const got = await acquireLease(
      db,
      { key: "dlsite", holder: "A", expiresAt: at(MINUTE_MS) },
      NOW,
    );

    expect(got).toBe(true);
    expect(await listLeases(db)).toEqual([
      { key: "dlsite", holder: "A", acquiredAt: NOW, expiresAt: at(MINUTE_MS) },
    ]);
  });

  /** 2 つの走行が同時に取りに来ても、札は 1 つしか無い */
  it("他人が期限内で持っていれば取れない", async () => {
    const db = await createMigratedTestDb();
    await acquireLease(db, { key: "dlsite", holder: "A", expiresAt: at(MINUTE_MS) }, NOW);

    const got = await acquireLease(
      db,
      { key: "dlsite", holder: "B", expiresAt: at(10 * MINUTE_MS) },
      NOW,
    );

    expect(got).toBe(false);
    // 札の中身は最初の持ち主のまま。期限も書き換わらない
    expect(await listLeases(db)).toEqual([
      { key: "dlsite", holder: "A", acquiredAt: NOW, expiresAt: at(MINUTE_MS) },
    ]);
  });

  it("期限が切れていれば別の走行が取れる", async () => {
    const db = await createMigratedTestDb();
    await acquireLease(db, { key: "dlsite", holder: "A", expiresAt: at(MINUTE_MS) }, NOW);

    const later = at(2 * MINUTE_MS);
    const got = await acquireLease(
      db,
      { key: "dlsite", holder: "B", expiresAt: at(3 * MINUTE_MS) },
      later,
    );

    expect(got).toBe(true);
    expect((await listLeases(db))[0]?.holder).toBe("B");
  });

  it("自分が持っている札は取り直せる (同じ走行が二度取っても失敗しない)", async () => {
    const db = await createMigratedTestDb();
    await acquireLease(db, { key: "dlsite", holder: "A", expiresAt: at(MINUTE_MS) }, NOW);

    const got = await acquireLease(
      db,
      { key: "dlsite", holder: "A", expiresAt: at(5 * MINUTE_MS) },
      NOW,
    );

    expect(got).toBe(true);
    expect((await listLeases(db))[0]?.expiresAt).toBe(at(5 * MINUTE_MS));
  });

  /**
   * 判定を SQL の WHERE に置いてある (読んでから書く形にしていない) ので、
   * 同時に投げても片方しか書けない
   */
  it("同時に取りに来ても片方だけが取れる", async () => {
    const db = await createMigratedTestDb();

    const results = await Promise.all([
      acquireLease(db, { key: "dlsite", holder: "A", expiresAt: at(MINUTE_MS) }, NOW),
      acquireLease(db, { key: "dlsite", holder: "B", expiresAt: at(MINUTE_MS) }, NOW),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    const leases = await listLeases(db);
    expect(leases).toHaveLength(1);
    // 取れたと答えた側が札を持っている
    expect(leases[0]?.holder).toBe(results[0] ? "A" : "B");
  });

  it("鍵が違えば互いに邪魔しない", async () => {
    const db = await createMigratedTestDb();

    expect(
      await acquireLease(db, { key: "dlsite", holder: "A", expiresAt: at(MINUTE_MS) }, NOW),
    ).toBe(true);
    expect(
      await acquireLease(db, { key: "audible", holder: "B", expiresAt: at(MINUTE_MS) }, NOW),
    ).toBe(true);
    expect((await listLeases(db)).map((lease) => lease.key)).toEqual(["audible", "dlsite"]);
  });
});

describe("extendLease", () => {
  it("持ち主なら期限を延ばせる", async () => {
    const db = await createMigratedTestDb();
    await acquireLease(db, { key: "dlsite", holder: "A", expiresAt: at(MINUTE_MS) }, NOW);

    const extended = await extendLease(
      db,
      { key: "dlsite", holder: "A", expiresAt: at(10 * MINUTE_MS) },
      at(30 * 1000),
    );

    expect(extended).toBe(true);
    expect((await listLeases(db))[0]?.expiresAt).toBe(at(10 * MINUTE_MS));
  });

  it("持ち主でなければ延ばせない", async () => {
    const db = await createMigratedTestDb();
    await acquireLease(db, { key: "dlsite", holder: "A", expiresAt: at(MINUTE_MS) }, NOW);

    const extended = await extendLease(
      db,
      { key: "dlsite", holder: "B", expiresAt: at(10 * MINUTE_MS) },
      at(30 * 1000),
    );

    expect(extended).toBe(false);
    expect((await listLeases(db))[0]?.expiresAt).toBe(at(MINUTE_MS));
  });

  /** 切れた札を延ばせると、その隙に他の走行が取った札を奪うことになる */
  it("期限が切れた後は延ばせない", async () => {
    const db = await createMigratedTestDb();
    await acquireLease(db, { key: "dlsite", holder: "A", expiresAt: at(MINUTE_MS) }, NOW);

    const extended = await extendLease(
      db,
      { key: "dlsite", holder: "A", expiresAt: at(10 * MINUTE_MS) },
      at(2 * MINUTE_MS),
    );

    expect(extended).toBe(false);
  });

  it("札が無ければ延ばせない", async () => {
    const db = await createMigratedTestDb();

    expect(
      await extendLease(db, { key: "dlsite", holder: "A", expiresAt: at(MINUTE_MS) }, NOW),
    ).toBe(false);
  });
});

describe("releaseLease", () => {
  it("持ち主なら返せる。返した後は誰でも取れる", async () => {
    const db = await createMigratedTestDb();
    await acquireLease(db, { key: "dlsite", holder: "A", expiresAt: at(10 * MINUTE_MS) }, NOW);

    expect(await releaseLease(db, { key: "dlsite", holder: "A" })).toBe(true);
    expect(await listLeases(db)).toEqual([]);
    expect(
      await acquireLease(db, { key: "dlsite", holder: "B", expiresAt: at(MINUTE_MS) }, NOW),
    ).toBe(true);
  });

  it("持ち主でなければ返せない", async () => {
    const db = await createMigratedTestDb();
    await acquireLease(db, { key: "dlsite", holder: "A", expiresAt: at(10 * MINUTE_MS) }, NOW);

    expect(await releaseLease(db, { key: "dlsite", holder: "B" })).toBe(false);
    expect(await listLeases(db)).toHaveLength(1);
  });
});

describe("leaseExpiry", () => {
  it("今から指定したぶん後の時刻を返す", () => {
    expect(leaseExpiry(5 * MINUTE_MS, NOW)).toBe(at(5 * MINUTE_MS));
  });
});
