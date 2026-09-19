import { expect, test } from "@playwright/test";
import { waitForHydration } from "./hydration";

test("トップページが SSR で描画される", async ({ page, request }) => {
  const raw = await request.get("/");
  expect(raw.status()).toBe(200);
  // JS を動かす前の HTML に新着が入っていること (クライアント描画に頼っていない)
  expect(await raw.text()).toContain("新着の音声作品");

  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: "好きな声優の音声作品を、ストアをまたいで追う" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "新着の音声作品" })).toBeVisible();
  await expect(page.getByRole("link", { name: "フォロー中", exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "各ストアとは関係のない非公式サービスです。作品情報は各ストアの公開ページをもとにしています。",
    ),
  ).toBeVisible();
});

test("トップの新着はストアのタブで切り替わり、既定は DLsite", async ({ page, request }) => {
  // 描画されるのは既定のタブだけ。3 ストアぶんはハイドレーション用のデータとして載るので、
  // 生 HTML 全体ではなく描画済みのマークアップ (リンク) で見る
  const html = await (await request.get("/")).text();
  expect(html).toMatch(/<a[^>]*>テスト用ASMR作品アルファ<\/a>/);
  expect(html).not.toMatch(/<a[^>]*>テスト用朗読作品アルファ<\/a>/);

  await page.goto("/");
  // タブの切り替えはクライアント側の状態。ハイドレーション前に押しても何も起きない
  await waitForHydration(page);
  const tabs = page.getByRole("tablist", { name: "ストアで絞り込む" });
  await expect(tabs.getByRole("tab", { name: "DLsite" })).toHaveAttribute("aria-selected", "true");

  // Audible の朗読作品は DLsite のタブには出ない
  await expect(page.getByRole("link", { name: "テスト用朗読作品アルファ" })).toBeHidden();

  await tabs.getByRole("tab", { name: "Audible" }).click();
  await expect(page.getByRole("link", { name: "テスト用朗読作品アルファ" })).toBeVisible();
  await expect(page.getByRole("link", { name: "テスト用ASMR作品アルファ" })).toBeHidden();

  // ポケドラは seed に作品が無い。空のタブでも画面は壊れない
  await tabs.getByRole("tab", { name: "ポケドラ" }).click();
  await expect(page.getByText("ポケドラ の新着はありません")).toBeVisible();
});

test("トップの新着カードは名寄せ済みの出演声優を出す", async ({ page, request }) => {
  // 名前は SSR の時点で入っている。カードから声優ページへ行けることが目的なのでリンクで見る
  const html = await (await request.get("/")).text();
  expect(html).toMatch(/href="\/voice-actors\/e2e-alpha"/);

  await page.goto("/");
  const card = page.getByRole("article").filter({ hasText: "テスト用ASMR作品アルファ" });
  await expect(card.getByRole("link", { name: "テスト声優アルファ" })).toBeVisible();
  await expect(card.getByRole("link", { name: "テスト声優デルタ" })).toBeVisible();
  // ストアの表記のまま残っている未解決のクレジットは出さない
  await expect(card.getByText("テスト未解決表記")).toBeHidden();

  await card.getByRole("link", { name: "テスト声優アルファ" }).click();
  await expect(page).toHaveURL(/\/voice-actors\/e2e-alpha$/);
});

test("声優一覧は SSR で声優ページへのリンクを並べる", async ({ page, request }) => {
  const raw = await request.get("/voice-actors");
  expect(raw.status()).toBe(200);
  expect(await raw.text()).toContain("テスト声優アルファ");

  await page.goto("/voice-actors");
  await expect(page.getByRole("heading", { level: 1, name: "声優から探す" })).toBeVisible();
  await page
    .getByRole("list", { name: "声優から探す" })
    .getByRole("link", { name: /テスト声優アルファ/ })
    .click();
  await expect(page).toHaveURL(/\/voice-actors\/e2e-alpha$/);
});

test("/anime はデータのある最新シーズンへ送る", async ({ page }) => {
  await page.goto("/anime");
  await expect(page).toHaveURL(/\/anime\/season\/\d{4}-(winter|spring|summer|fall)$/);
  await expect(page.getByRole("heading", { level: 1, name: /アニメ$/ })).toBeVisible();
});
