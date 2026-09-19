import { expect, test } from "@playwright/test";
import { waitForHydration } from "./hydration";

const NAME = "テスト声優アルファ";

/**
 * フォローはブラウザ内 (IndexedDB) にしか無い。Playwright はテストごとに新しい
 * コンテキストを作るので、毎回フォロー 0 件から始まる
 */
test("検索からフォローすると、フォロー中のページに作品が並び、解除で消える", async ({ page }) => {
  await page.goto("/");
  await waitForHydration(page);

  await page.getByLabel("声優名で検索").fill(NAME);

  const results = page.getByRole("list", { name: "検索結果" });
  const row = results.getByRole("listitem").filter({ hasText: NAME });
  await row.getByRole("button", { name: "フォロー", exact: true }).click();

  // トップはフォローの有無で中身が入れ替わらない。変わるのはフォロー中への導線が出ることだけ
  await expect(page.getByRole("heading", { level: 2, name: "新着の音声作品" })).toBeVisible();
  await expect(page.getByRole("link", { name: "フォロー中の新着" })).toBeVisible();

  await page.getByRole("link", { name: "フォロー中", exact: true }).click();
  await expect(page).toHaveURL(/\/following$/);

  // このページの主役は作品。フォロー中の声優はその上の管理欄に出る
  await expect(page.getByRole("link", { name: "テスト用ASMR作品アルファ" })).toBeVisible();
  const followingList = page.getByRole("list", { name: "フォロー中の声優" });
  await expect(followingList.getByRole("link", { name: NAME })).toBeVisible();

  await page.getByRole("button", { name: `${NAME}のフォローを解除` }).click();
  await expect(page.getByText("まだ誰もフォローしていません")).toBeVisible();
});

/**
 * フィードは 発売予定 / 30 日以内 / それ以前 の 3 段。
 * seed.sql の 4 件目が 14 日後の発売なので、先頭に「今後の発売」が出る
 */
test("フィードは段に分かれ、発売予定の作品が先頭の段に出る", async ({ page }) => {
  await page.goto("/voice-actors/e2e-alpha");
  await page.getByRole("button", { name: "フォロー", exact: true }).click();
  await expect(page.getByRole("button", { name: "フォロー中" })).toBeVisible();

  await page.goto("/following");
  await expect(page.getByRole("heading", { level: 1, name: "フォロー中" })).toBeVisible();

  await expect(page.getByRole("heading", { level: 2, name: /今後の発売/ })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /30 日以内の新作/ })).toBeVisible();

  // 発売予定の作品は上の段にだけ出て、発売日ではなく「発売予定」として表示される
  await expect(page.getByRole("link", { name: "テスト用発売予定作品アルファ" })).toBeVisible();
  await expect(page.getByText(/発売予定 \d+月\d+日/)).toBeVisible();
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
