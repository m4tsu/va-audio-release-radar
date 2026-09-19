import { expect, test } from "@playwright/test";

/**
 * 利用規約とプライバシーポリシー。どちらも SSR で本文まで出ること (JS 無しでも読める)、
 * フッターから辿れること、英語に切り替えると本文も英語になることを見る
 */
for (const { path, title, sectionJa, sectionEn } of [
  {
    path: "/terms",
    title: "利用規約",
    sectionJa: "第1条 (本規約の適用)",
    sectionEn: "1. Scope",
  },
  {
    path: "/privacy",
    title: "プライバシーポリシー",
    sectionJa: "1. 基本方針",
    sectionEn: "1. Overview",
  },
]) {
  test(`${path} が SSR で描画され、フッターから辿れる`, async ({ page, request }) => {
    const raw = await request.get(path);
    expect(raw.status()).toBe(200);
    expect(await raw.text()).toContain(sectionJa);

    await page.goto("/");
    await page.getByRole("contentinfo").getByRole("link", { name: title }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: sectionJa })).toBeVisible();
  });

  test(`${path} は英語でも本文が出る`, async ({ page, context, baseURL }) => {
    // 言語切り替えの部品は locale-select.test.tsx が見ている。ここは SSR が cookie を読む経路だけ
    await context.addCookies([{ name: "locale", value: "en", url: baseURL ?? "" }]);
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 2, name: sectionEn })).toBeVisible();
  });
}
