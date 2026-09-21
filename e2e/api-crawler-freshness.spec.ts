import { expect, test } from "@playwright/test";

/**
 * E2E に置く理由: **SSR の応答** (状態コード)。外形監視はこの状態だけを見て判断するので、
 * 実際の Worker が返す値で固定する。
 *
 * 固定データ (`e2e/fixtures/seed.sql`) の走行はすべて声優起点で、日次の走行が 1 件も無い。
 * 鮮度は日次だけを数えるので、3 ストアとも「まだ 1 度も成功していない」になる
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
