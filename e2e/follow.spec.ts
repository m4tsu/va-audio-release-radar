import { expect, type Page, test } from "@playwright/test";

const NAME = "テスト声優アルファ";

/**
 * トップの検索欄は制御された input なので、ハイドレーション前に文字を入れても
 * React が空に戻してしまう。フォロー状態を読み終えたときだけ出る説明文を
 * 「クライアントが動き出した」合図として待つ
 */
async function waitForHydration(page: Page): Promise<void> {
  await expect(page.getByText("好きな声優をフォローすると")).toBeVisible();
}

/**
 * フォローはブラウザ内 (IndexedDB) にしか無い。Playwright はテストごとに新しい
 * コンテキストを作るので、毎回フォロー 0 件から始まる
 */
test("フォローするとトップがフィードに変わり、/following に出て、解除で消える", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "最近の新着 (全声優)" })).toBeVisible();
  await waitForHydration(page);

  await page.getByLabel("声優を探してフォローする").fill(NAME);

  const results = page.getByRole("list", { name: "検索結果" });
  const row = results.getByRole("listitem").filter({ hasText: NAME });
  await row.getByRole("button", { name: "フォロー", exact: true }).click();

  // トップの主役が「フォロー中の新着」に入れ替わる
  await expect(page.getByRole("heading", { level: 1, name: "フォロー中の新着" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: NAME })).toBeVisible();
  await expect(page.getByRole("link", { name: "テスト用ASMR作品アルファ" })).toBeVisible();

  await page.getByRole("link", { name: "フォロー中", exact: true }).click();
  await expect(page).toHaveURL(/\/following$/);
  const followingList = page.getByRole("list", { name: "フォロー中の声優" });
  await expect(followingList.getByRole("link", { name: NAME })).toBeVisible();

  await page.getByRole("button", { name: "フォロー解除" }).click();
  await expect(page.getByText("まだ誰もフォローしていません")).toBeVisible();

  // 解除はトップにも効く
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "最近の新着 (全声優)" })).toBeVisible();
});

test("フォローはページをまたいで保持される", async ({ page }) => {
  await page.goto("/voice-actors/e2e-alpha");
  // 読み込みが済むまでボタンは disabled。click は有効になるまで待つ
  await page.getByRole("button", { name: "フォロー", exact: true }).click();
  await expect(page.getByRole("button", { name: "フォロー中" })).toBeVisible();

  await page.goto("/following");
  await expect(
    page.getByRole("list", { name: "フォロー中の声優" }).getByRole("link", { name: NAME }),
  ).toBeVisible();
});
