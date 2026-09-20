import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

/**
 * 管理画面のトークン。`?token=` を落として cookie に移す経路はサーバーの応答 (303) と
 * ブラウザの cookie の両方をまたぐので、jsdom では確かめられない。
 * 画面の中身は `src/app/pages/admin/**` のテストが見るので、ここでは認可の経路だけ見る。
 *
 * トークンは `.dev.vars` の ADMIN_TOKEN。
 * e2e/fixtures/prepare.mjs が無ければ既定値で作るので、ここでは読むだけにする
 */
function adminToken(): string {
  try {
    const line = readFileSync(".dev.vars", "utf8")
      .split("\n")
      .find((row) => row.startsWith("ADMIN_TOKEN="));
    return line?.slice("ADMIN_TOKEN=".length).trim() || "dev-admin";
  } catch {
    return "dev-admin";
  }
}

test("トークン無しの /admin/crawler-health はトークンを要求する", async ({ page }) => {
  await page.goto("/admin/crawler-health");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("管理者トークンが必要です");
  await expect(page.getByRole("table")).toHaveCount(0);
});

test("?token= を付けると cookie が立ち、URL からトークンが消えて表が出る", async ({ page }) => {
  await page.goto(`/admin/crawler-health?token=${adminToken()}`);

  // 303 で同じパスへ送り直されるため、URL にトークンは残らない
  await expect(page).toHaveURL(/\/admin\/crawler-health$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("クローラー健全性");
  await expect(page.getByRole("table")).toBeVisible();

  // cookie は同じブラウザで別の管理画面にも効く
  await page.goto("/admin/unmatched-credits");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("未解決クレジット");
});

test("一致しない ?token= では cookie を立てない", async ({ page }) => {
  await page.goto("/admin/crawler-health?token=wrong-token");

  // 応答の形は一致した場合と同じ (トークンを落として同じパスへ送り直すだけ)
  await expect(page).toHaveURL(/\/admin\/crawler-health$/);
  // cookie が立っていないので画面は入れないまま
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("管理者トークンが必要です");
  const cookies = await page.context().cookies();
  expect(cookies.find((cookie) => cookie.name === "admin_token")).toBeUndefined();
});
