import { expect, test } from "@playwright/test";

/**
 * アニメ 1 作品のページの表示言語。
 *
 * e2e/fixtures/seed.sql のアニメは日本語名と英語名が別の文字列で、役の英語表記 (character_name_full)
 * は持たない。英語名とローマ字名は同じ文字列なので、英語名が無い作品の落とし分けはここでは見ない
 * (その規則は src/app/lib/anime-title.ts の単体テストが持つ)
 */
const SLUG = "e2e-anime-alpha";
const NATIVE = "テストアニメアルファ";
const ENGLISH = "Test Anime Alpha";
const CHARACTER = "テストキャラアルファ";

test("日本語表示では見出しが日本語名、副題が英語名になる", async ({ page }) => {
  await page.goto(`/anime/${SLUG}`);

  await expect(page.getByRole("heading", { level: 1, name: NATIVE })).toBeVisible();
  await expect(page.getByText(`2026 年秋 ／ ${ENGLISH}`)).toBeVisible();
  await expect(page.getByText(CHARACTER)).toBeVisible();
});

test("英語表示では見出しが英語名、副題が日本語名になる", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "locale", value: "en", url: baseURL ?? "" }]);
  await page.goto(`/anime/${SLUG}`);

  await expect(page.getByRole("heading", { level: 1, name: ENGLISH })).toBeVisible();
  await expect(page.getByText(`Fall 2026 / ${NATIVE}`)).toBeVisible();
  // 役の英語表記が無い出演は、英語表示でも日本語の役名のまま出る (名前が消えない)
  await expect(page.getByText(CHARACTER)).toBeVisible();
});

test("title と meta description のアニメ名も表示言語で切り替わる", async ({ request }) => {
  const ja = await (await request.get(`/anime/${SLUG}`)).text();
  expect(ja).toContain(`<title>${NATIVE}の出演声優の音声作品</title>`);
  expect(ja).toMatch(new RegExp(`<meta name="description" content="${NATIVE}の出演声優のうち`));

  const en = await (
    await request.get(`/anime/${SLUG}`, { headers: { cookie: "locale=en" } })
  ).text();
  expect(en).toContain(`<title>Audio works by the cast of ${ENGLISH}</title>`);
  expect(en).toMatch(new RegExp(`<meta name="description" content="[^"]*from ${ENGLISH} with`));
});

test("英語表示ではシーズン一覧のアニメ名も英語名になる", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "locale", value: "en", url: baseURL ?? "" }]);
  await page.goto("/anime/season/2026-fall");

  await expect(page.getByRole("link", { name: new RegExp(ENGLISH) })).toBeVisible();
  await expect(page.getByText(NATIVE)).toHaveCount(0);
});
