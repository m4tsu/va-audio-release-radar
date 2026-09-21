import { expect, test } from "@playwright/test";

/**
 * 外形監視が見る経路。本文ではなく HTTP の状態で判断できることを固定する。
 * E2E 用の D1 には成功した取り込みが無いので、503 と「まだ 1 度も成功していない」形になる
 */
test("GET /api/crawler-freshness が取り込みの無いストアを 503 で返す", async ({ request }) => {
  const res = await request.get("/api/crawler-freshness");

  expect(res.status()).toBe(503);
  const body = await res.json();
  expect(body.ok).toBe(false);
  expect(body.stores.map((store: { storeSlug: string }) => store.storeSlug)).toEqual([
    "dlsite",
    "audible",
    "pokedora",
  ]);
  expect(body.stores.every((store: { fresh: boolean }) => !store.fresh)).toBe(true);
  // 監視が古い応答を掴まないようにしている
  expect(res.headers()["cache-control"]).toContain("no-store");
});
