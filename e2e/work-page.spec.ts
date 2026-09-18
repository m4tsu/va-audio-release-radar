import { expect, test } from "@playwright/test";

/** sitemap と同じ形 (コロンを %3A に符号化した作品 ID) で開く */
const WORK_PATH = "/works/dlsite%3ARJ90000001";

test("作品ページのストアリンクは rel に nofollow と sponsored を付ける", async ({ page }) => {
  await page.goto(WORK_PATH);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("テスト用ASMR作品アルファ");

  const storeLink = page.getByRole("link", { name: "DLsite で見る" });
  await expect(storeLink).toHaveAttribute("rel", /nofollow/);
  await expect(storeLink).toHaveAttribute("rel", /sponsored/);
  await expect(storeLink).toHaveAttribute("target", "_blank");
  // アフィリエイト URL がある listing なので、正規 URL ではなくそちらへ送る
  await expect(storeLink).toHaveAttribute("href", /dlaf/);
});

test("作品ページは価格・クレジット・未解決表記を出す", async ({ page }) => {
  await page.goto(WORK_PATH);
  await expect(page.getByText("¥1,584")).toBeVisible();
  await expect(page.getByText("1時間26分")).toBeVisible();
  // 名寄せ済みのクレジットは声優ページへのリンクになる
  await expect(page.getByRole("link", { name: "テスト声優アルファ" })).toBeVisible();
  // 未解決のクレジットはストア上の表記のまま出す
  await expect(page.getByText("テスト未解決表記")).toBeVisible();
});
