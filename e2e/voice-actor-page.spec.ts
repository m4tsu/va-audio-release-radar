import { expect, test } from "@playwright/test";

/** e2e/fixtures/seed.sql が入れている声優 */
const SLUG = "e2e-alpha";
const NAME = "テスト声優アルファ";

test("声優ページは title と作品一覧を SSR で返す", async ({ request }) => {
  const res = await request.get(`/voice-actors/${SLUG}`);
  expect(res.status()).toBe(200);

  const html = await res.text();
  expect(html).toContain(`<title>${NAME}の新着音声作品 | DLsite・Audible</title>`);
  expect(html).toContain(`${NAME}が出演する DLsite の ASMR・ボイス作品`);
  // 作品名が生 HTML に含まれる = 検索エンジンが中身を読める
  // ハイドレーション用のデータではなく、描画済みのマークアップに入っていることを見る
  expect(html).toMatch(new RegExp(`<h1[^>]*>${NAME}の新着音声作品</h1>`));
  expect(html).toMatch(/<h2[^>]*>DLsite<\/h2>/);
  expect(html).toMatch(/<a[^>]*>テスト用ASMR作品アルファ<\/a>/);
  expect(html).toMatch(/<a[^>]*>テスト用朗読作品アルファ<\/a>/);
  // canonical と og:url は絶対 URL (SITE_URL 未設定ならリクエストのオリジン)
  expect(html).toContain(
    `<link rel="canonical" href="http://localhost:5199/voice-actors/${SLUG}"/>`,
  );
  expect(html).toContain(
    `<meta property="og:url" content="http://localhost:5199/voice-actors/${SLUG}"/>`,
  );
  expect(html).toContain('"@type":"Person"');
});

test("JSON-LD は < をエスケープして出す", async ({ request }) => {
  const res = await request.get(`/voice-actors/${SLUG}`);
  const html = await res.text();

  // ld+json の中身に生の "<" が残っていると、名前に "</script>" を含む声優で要素が閉じる
  const jsonLd = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
  expect(jsonLd).toBeDefined();
  expect(jsonLd).not.toContain("<");
  expect(JSON.parse(jsonLd ?? "{}")["@type"]).toBe("Person");
});

test("ストアごとのセクションが両方出る", async ({ page }) => {
  await page.goto(`/voice-actors/${SLUG}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${NAME}の新着音声作品`);
  await expect(page.getByRole("heading", { level: 2, name: "DLsite" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Audible" })).toBeVisible();
});

test("作品が無いストアのセクションも出る", async ({ page }) => {
  // ベータは DLsite にしか作品が無い
  await page.goto("/voice-actors/e2e-beta");
  await expect(page.getByRole("heading", { level: 2, name: "Audible" })).toBeVisible();
  await expect(page.getByText("まだ見つかっていません")).toBeVisible();
});
