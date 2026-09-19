import { expect, type Page, test } from "@playwright/test";
import { waitForHydration } from "./hydration";

/**
 * 声優一覧の並べ替え・絞り込み・フォロー。
 *
 * e2e/fixtures/seed.sql の 4 人のうち、一覧に出るのは作品がある 3 人。
 * 名前順は アルファ (3 作品) → デルタ (4 作品) → ベータ (1 作品)、
 * 作品数の多い順は デルタ → アルファ → ベータ になる
 */
const ALPHA = "テスト声優アルファ";
const ALPHA_EN = "E2E Actor Alpha";
const BETA = "テスト声優ベータ";
const DELTA = "テスト声優デルタ";

function directory(page: Page) {
  return page.getByRole("list", { name: "声優から探す" });
}

function storeFilter(page: Page) {
  return page.getByRole("group", { name: "ストアで絞り込む" });
}

test("並び替えを作品数の多い順にすると、作品数の多い声優が先に来る", async ({ page }) => {
  await page.goto("/voice-actors");
  await waitForHydration(page);

  // 何も操作していない状態は名前順。SSR が返す並びと同じ
  await expect(directory(page).getByRole("listitem").first()).toContainText(ALPHA);

  await page.getByRole("combobox", { name: "並び替え: 名前順" }).click();
  await page.getByRole("option", { name: "作品数の多い順" }).click();

  await expect(directory(page).getByRole("listitem").first()).toContainText(DELTA);
  // 並べ替えても人数は変わらない
  await expect(page.getByText("3 人")).toBeVisible();
});

test("ストアで絞ると、そのストアに作品がある声優だけが残る", async ({ page }) => {
  await page.goto("/voice-actors");
  await waitForHydration(page);
  await expect(page.getByText("3 人")).toBeVisible();

  // ベータは DLsite にしか作品が無いので Audible では消える
  await storeFilter(page).getByRole("button", { name: "Audible" }).click();
  await expect(directory(page).getByRole("listitem").filter({ hasText: ALPHA })).toBeVisible();
  await expect(directory(page).getByRole("listitem").filter({ hasText: BETA })).toHaveCount(0);
  await expect(page.getByText("2 人")).toBeVisible();

  await storeFilter(page).getByRole("button", { name: "すべて" }).click();
  await expect(directory(page).getByRole("listitem").filter({ hasText: BETA })).toBeVisible();
  await expect(page.getByText("3 人")).toBeVisible();
});

test("絞り込んだ結果が 0 人でも画面は空にならない", async ({ page }) => {
  await page.goto("/voice-actors");
  await waitForHydration(page);

  // seed にポケドラの作品は無い
  await storeFilter(page).getByRole("button", { name: "ポケドラ" }).click();
  await expect(page.getByText("ポケドラ に作品がある声優はいません")).toBeVisible();
  await expect(page.getByText("0 人")).toBeVisible();
});

test("英語表示では、ローマ字を持つ声優はローマ字、持たない声優は漢字表記で出る", async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([{ name: "locale", value: "en", url: baseURL ?? "" }]);
  await page.goto("/voice-actors");

  // 一覧の aria-label も英語になるので、日本語のときとは別に取り直す
  const list = page.getByRole("list", { name: "Voice actors" });
  await expect(list.getByRole("link", { name: ALPHA_EN })).toBeVisible();
  // ベータには name_en が無い。英語表示でも名前が消えず日本語表記のまま出る
  await expect(list.getByRole("link", { name: BETA })).toBeVisible();

  await page.goto("/voice-actors/e2e-alpha");
  await expect(page.getByRole("heading", { level: 1, name: ALPHA_EN })).toBeVisible();
});

test("一覧からフォローすると、声優ページでもフォロー済みになっている", async ({ page }) => {
  await page.goto("/voice-actors");
  await waitForHydration(page);

  const row = directory(page).getByRole("listitem").filter({ hasText: BETA });
  await row.getByRole("button", { name: "フォロー", exact: true }).click();
  // フォロー済みは一覧の上でも見分けが付く
  await expect(row.getByRole("button", { name: "フォロー中" })).toBeVisible();

  await page.goto("/voice-actors/e2e-beta");
  await expect(page.getByRole("button", { name: "フォロー中" })).toBeVisible();
});
