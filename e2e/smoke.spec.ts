import { expect, test } from "@playwright/test";

test("トップページが SSR で描画される", async ({ page, request }) => {
  const raw = await request.get("/");
  expect(raw.status()).toBe(200);
  // JS を動かす前の HTML に新着が入っていること (クライアント描画に頼っていない)
  expect(await raw.text()).toContain("最近の新着");

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "最近の新着 (全声優)" })).toBeVisible();
  await expect(page.getByRole("link", { name: "フォロー中" })).toBeVisible();
  await expect(
    page.getByText("非公式サービス。作品情報は各ストアの公開情報に基づく。"),
  ).toBeVisible();
});
