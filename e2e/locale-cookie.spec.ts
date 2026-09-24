import { expect, test } from "@playwright/test";

/**
 * 表示言語の cookie をサーバーが読んで、SSR の出力が切り替わること。
 *
 * cookie を読むのはサーバーなので jsdom では確かめられない。
 * 切り替わった先の画面の中身は `src/app/pages/**` のテストが見るので、ここでは経路だけ見る
 */

const SLUG = "e2e-anime-alpha";
const NATIVE = "テストアニメアルファ";
const ENGLISH = "Test Anime Alpha";

test("cookie が無ければ日本語の title と本文を返す", async ({ request }) => {
  const html = await (await request.get(`/anime/${SLUG}`)).text();

  expect(html).toContain(`<title>${NATIVE}の出演声優の音声作品</title>`);
  expect(html).toMatch(new RegExp(`<meta name="description" content="${NATIVE}の出演声優のうち`));
});

test("locale=en の cookie があれば title も meta も英語になる", async ({ request }) => {
  const html = await (
    await request.get(`/anime/${SLUG}`, { headers: { cookie: "locale=en" } })
  ).text();

  expect(html).toContain(`<title>Audio works by the cast of ${ENGLISH}</title>`);
  expect(html).toMatch(new RegExp(`<meta name="description" content="[^"]*from ${ENGLISH} with`));
});

/** 作品の meta description に並ぶ出演声優も、cookie の言語に合わせた表記になる */
test("locale=en の cookie があれば作品の meta に声優のローマ字表記を並べる", async ({
  request,
}) => {
  const path = "/works/dlsite%3ARJ90000001";
  const native = await (await request.get(path)).text();
  expect(native).toMatch(/<meta name="description" content="[^"]*テスト声優アルファ/);

  const english = await (await request.get(path, { headers: { cookie: "locale=en" } })).text();
  expect(english).toMatch(/<meta name="description" content="Featuring [^"]*E2E Actor Alpha/);
  expect(english).not.toMatch(/<meta name="description" content="[^"]*テスト声優アルファ/);
});

test("locale=en の cookie は本文と lang 属性にも効く", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "locale", value: "en", url: baseURL ?? "" }]);
  await page.goto("/voice-actors");

  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1, name: "Voice actors" })).toBeVisible();
});
