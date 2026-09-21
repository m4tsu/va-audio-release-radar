import { describe, expect, it } from "vitest";
import { crawlRuns } from "../db/schema";
import { createMigratedTestDb } from "../db/test-db";
import type { AppDb } from "../db/types";
import { lastSuccessAt, loadCrawlerFreshness, STALE_AFTER_HOURS } from "./freshness";

/** 基準時刻。鮮度の境目をこの時点から組み立てて結果を固定する */
const NOW = "2026-09-21T12:00:00.000Z";
const HOUR_MS = 60 * 60 * 1000;

function hoursAgo(hours: number): string {
  return new Date(Date.parse(NOW) - hours * HOUR_MS).toISOString();
}

async function insertRun(
  db: AppDb,
  run: {
    id: string;
    storeSlug: "dlsite" | "audible" | "pokedora";
    status: "ok" | "error";
    finishedAt?: string;
  },
): Promise<void> {
  await db.insert(crawlRuns).values({
    id: run.id,
    storeSlug: run.storeSlug,
    startedAt: run.finishedAt ?? NOW,
    finishedAt: run.finishedAt ?? null,
    status: run.status,
  });
}

describe("loadCrawlerFreshness", () => {
  it("1 度も走っていないストアも並べ、fresh を立てない", async () => {
    const db = await createMigratedTestDb();

    const freshness = await loadCrawlerFreshness(db, NOW);

    // 黙って消すと「まだ始めていない」と「止まった」を取り違える
    expect(freshness.stores.map((store) => store.storeSlug)).toEqual([
      "dlsite",
      "audible",
      "pokedora",
    ]);
    expect(freshness.stores.every((store) => store.fresh)).toBe(false);
    expect(freshness.stores[0]?.lastSuccessAt).toBeUndefined();
    expect(freshness.ok).toBe(false);
  });

  it("直近に成功した取り込みがあれば fresh になる", async () => {
    const db = await createMigratedTestDb();
    for (const storeSlug of ["dlsite", "audible", "pokedora"] as const) {
      await insertRun(db, {
        id: `r-${storeSlug}`,
        storeSlug,
        status: "ok",
        finishedAt: hoursAgo(2),
      });
    }

    const freshness = await loadCrawlerFreshness(db, NOW);

    expect(freshness.ok).toBe(true);
    expect(freshness.stores.every((store) => store.fresh)).toBe(true);
    expect(freshness.stores[0]?.ageHours).toBe(2);
    expect(freshness.staleAfterHours).toBe(STALE_AFTER_HOURS);
  });

  it("しきい値のちょうどは新しい、超えたら古い", async () => {
    const db = await createMigratedTestDb();
    await insertRun(db, {
      id: "just",
      storeSlug: "dlsite",
      status: "ok",
      finishedAt: hoursAgo(STALE_AFTER_HOURS),
    });
    await insertRun(db, {
      id: "over",
      storeSlug: "audible",
      status: "ok",
      finishedAt: hoursAgo(STALE_AFTER_HOURS + 0.5),
    });

    const freshness = await loadCrawlerFreshness(db, NOW);
    const byStore = new Map(freshness.stores.map((store) => [store.storeSlug, store]));

    expect(byStore.get("dlsite")?.fresh).toBe(true);
    expect(byStore.get("audible")?.fresh).toBe(false);
  });

  it("失敗した走行は成功として数えない", async () => {
    const db = await createMigratedTestDb();
    await insertRun(db, {
      id: "old-ok",
      storeSlug: "dlsite",
      status: "ok",
      finishedAt: hoursAgo(40),
    });
    // 新しいが失敗。これで fresh になってしまうと、壊れたまま緑に見える
    await insertRun(db, {
      id: "new-ng",
      storeSlug: "dlsite",
      status: "error",
      finishedAt: hoursAgo(1),
    });

    const freshness = await loadCrawlerFreshness(db, NOW);
    const dlsite = freshness.stores.find((store) => store.storeSlug === "dlsite");

    expect(dlsite?.lastSuccessAt).toBe(hoursAgo(40));
    expect(dlsite?.fresh).toBe(false);
    expect(freshness.ok).toBe(false);
  });

  it("1 つでも古ければ ok にしない", async () => {
    const db = await createMigratedTestDb();
    await insertRun(db, { id: "a", storeSlug: "dlsite", status: "ok", finishedAt: hoursAgo(1) });
    await insertRun(db, { id: "b", storeSlug: "audible", status: "ok", finishedAt: hoursAgo(1) });
    await insertRun(db, { id: "c", storeSlug: "pokedora", status: "ok", finishedAt: hoursAgo(99) });

    const freshness = await loadCrawlerFreshness(db, NOW);

    expect(freshness.ok).toBe(false);
  });

  // 取り込みを受けた時刻を使う。取得を始めた時刻は数時間前のことがある
  it("finishedAt が無い走行は成功として数えない", async () => {
    const db = await createMigratedTestDb();
    await insertRun(db, { id: "no-finish", storeSlug: "dlsite", status: "ok" });

    const freshness = await loadCrawlerFreshness(db, NOW);
    const dlsite = freshness.stores.find((store) => store.storeSlug === "dlsite");

    expect(dlsite?.lastSuccessAt).toBeUndefined();
    expect(dlsite?.fresh).toBe(false);
  });
});

describe("lastSuccessAt", () => {
  it("そのストアの成功した走行のうち最新を返す", async () => {
    const db = await createMigratedTestDb();
    await insertRun(db, { id: "old", storeSlug: "dlsite", status: "ok", finishedAt: hoursAgo(5) });
    await insertRun(db, { id: "new", storeSlug: "dlsite", status: "ok", finishedAt: hoursAgo(1) });
    await insertRun(db, { id: "other", storeSlug: "audible", status: "ok", finishedAt: NOW });

    expect(await lastSuccessAt(db, "dlsite")).toBe(hoursAgo(1));
  });

  it("成功が無ければ undefined", async () => {
    const db = await createMigratedTestDb();
    await insertRun(db, { id: "ng", storeSlug: "dlsite", status: "error", finishedAt: NOW });

    expect(await lastSuccessAt(db, "dlsite")).toBeUndefined();
  });
});
