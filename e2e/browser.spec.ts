import { expect, test } from "@playwright/test";
import { waitForHydration } from "./hydration";

/**
 * ブラウザでしか再現しないもの。
 *
 * - ハイドレーション: React が動き出す前後で入力とクリックの届き方が変わる
 * - IndexedDB: フォローはブラウザ内にしか無く、jsdom には IndexedDB が無い
 *
 * 画面の見た目・並び・文言は jsdom のページテストが見るので、ここでは経路だけを通す。
 * Playwright はテストごとに新しいコンテキストを作るので、毎回フォロー 0 件から始まる
 */

const NAME = "テスト声優アルファ";

test("検索からフォローすると、フォロー中のページに作品が並び、解除で消える", async ({ page }) => {
  await page.goto("/");
  await waitForHydration(page);

  await page.getByLabel("声優名で検索").fill(NAME);

  const results = page.getByRole("list", { name: "検索結果" });
  const row = results.getByRole("listitem").filter({ hasText: NAME });
  await row.getByRole("button", { name: "フォロー", exact: true }).click();

  // トップはフォローの有無で中身が入れ替わらない。変わるのはフォロー中への導線が出ることだけ
  await expect(page.getByRole("link", { name: "フォロー中の新着" })).toBeVisible();

  await page.getByRole("link", { name: "フォロー中", exact: true }).click();
  await expect(page).toHaveURL(/\/following$/);

  await expect(page.getByRole("link", { name: "テスト用ASMR作品アルファ" })).toBeVisible();

  await page.getByRole("button", { name: `${NAME}のフォローを解除` }).click();
  await expect(page.getByText("まだ誰もフォローしていません")).toBeVisible();
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

/** ハイドレーション前に押しても何も起きない。動き出してから切り替わることを見る */
test("トップの新着タブはハイドレーション後に切り替わる", async ({ page }) => {
  await page.goto("/");
  await waitForHydration(page);

  const tabs = page.getByRole("tablist", { name: "ストアで絞り込む" });
  await expect(tabs.getByRole("tab", { name: "DLsite" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("link", { name: "テスト用朗読作品アルファ" })).toBeHidden();

  await tabs.getByRole("tab", { name: "Audible" }).click();
  await expect(page.getByRole("link", { name: "テスト用朗読作品アルファ" })).toBeVisible();
});
