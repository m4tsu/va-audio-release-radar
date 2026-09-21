import { expect, test } from "@playwright/test";
import { expectFollowsStored } from "./follow";
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
  await expectFollowsStored(page, 1);

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

/**
 * アニメのページからその場でフォローする経路。押しても声優ページへ移らないことと、
 * 読み込み直しても残ること (IndexedDB) を見る
 */
test("アニメのキャストからフォローしても移動せず、読み込み直しても残る", async ({ page }) => {
  await page.goto("/anime/e2e-anime-alpha");
  // キャストは出演者全員なので行が複数ある。押すのは先頭の 1 行だけ
  await page.getByRole("button", { name: "フォロー", exact: true }).first().click();

  await expect(page).toHaveURL(/\/anime\/e2e-anime-alpha$/);
  await expect(page.getByRole("button", { name: "フォロー中" })).toBeVisible();
  await expectFollowsStored(page, 1);

  await page.reload();
  await expect(page.getByRole("button", { name: "フォロー中" })).toBeVisible();

  await page.getByRole("button", { name: "フォロー中" }).click();
  await expect(page.getByRole("button", { name: "フォロー", exact: true }).first()).toBeVisible();
});

/** フォローに依存する表示は SSR の応答に無く、ブラウザの保存を読んでから現れる */
test("シーズンの一覧の印と絞り込みはフォローしてから出る", async ({ page }) => {
  await page.goto("/anime/season/2026-fall");
  await waitForHydration(page);
  await expect(page.getByRole("checkbox")).toHaveCount(0);

  await page.goto("/anime/e2e-anime-alpha");
  await page.getByRole("button", { name: "フォロー", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "フォロー中" })).toBeVisible();
  await expectFollowsStored(page, 1);

  await page.goto("/anime/season/2026-fall");
  await expect(
    page.getByRole("checkbox", { name: "フォロー中の声優が出ている作品だけ" }),
  ).toBeVisible();
  await expect(page.getByText("フォロー中の声優が出演")).toBeVisible();
});

/**
 * ハイドレーション: ルーターはマウント時に検索文字列を組み直し、今の URL と違えば書き戻す。
 * 絞り込みの既定値を検索文字列に載せると、素の URL が `?appearance=all` に化け、
 * SSR が出す canonical (欄なし) と食い違う
 */
test("出演形態の絞り込みは選んだときだけ URL に入る", async ({ page }) => {
  await page.goto("/voice-actors/e2e-alpha");
  await waitForHydration(page);

  await expect(page).toHaveURL(/\/voice-actors\/e2e-alpha$/);

  await page.getByRole("combobox", { name: "出演形態: すべて" }).click();
  await page.getByRole("option", { name: "少人数" }).click();

  await expect(page).toHaveURL(/\/voice-actors\/e2e-alpha\?appearance=small$/);

  await page.getByRole("combobox", { name: "出演形態: 少人数" }).click();
  await page.getByRole("option", { name: "すべて" }).click();

  await expect(page).toHaveURL(/\/voice-actors\/e2e-alpha$/);
});
