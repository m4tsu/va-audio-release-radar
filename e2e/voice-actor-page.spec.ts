import { expect, test } from "@playwright/test";

/** e2e/fixtures/seed.sql が入れている声優 */
const SLUG = "e2e-alpha";
const NAME = "テスト声優アルファ";

test("声優ページは title と作品一覧を SSR で返す", async ({ request, baseURL }) => {
  const res = await request.get(`/voice-actors/${SLUG}`);
  expect(res.status()).toBe(200);

  const html = await res.text();
  expect(html).toContain(
    `<title>${NAME}の音声作品 (ASMR・朗読・ボイスドラマ) | DLsite・Audible・ポケットドラマCD</title>`,
  );
  expect(html).toContain(`${NAME}が出演する ASMR・朗読・ボイスドラマを`);
  // 作品名が生 HTML に含まれる = 検索エンジンが中身を読める
  // ハイドレーション用のデータではなく、描画済みのマークアップに入っていることを見る
  expect(html).toMatch(new RegExp(`<h1[^>]*>${NAME}の音声作品</h1>`));
  expect(html).toMatch(/<h2[^>]*>DLsite<\/h2>/);
  expect(html).toMatch(/<a[^>]*>テスト用ASMR作品アルファ<\/a>/);
  expect(html).toMatch(/<a[^>]*>テスト用朗読作品アルファ<\/a>/);
  // canonical と og:url は絶対 URL (SITE_URL 未設定ならリクエストのオリジン)。
  // オリジンは baseURL から取る。ポートを直書きすると playwright.config.ts を変えた途端に落ちる
  expect(html).toContain(`<link rel="canonical" href="${baseURL}/voice-actors/${SLUG}"/>`);
  expect(html).toContain(`<meta property="og:url" content="${baseURL}/voice-actors/${SLUG}"/>`);
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
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${NAME}の音声作品`);
  await expect(page.getByRole("heading", { level: 2, name: "DLsite" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Audible" })).toBeVisible();
});

test("作品が無いストアのセクションも出る", async ({ page }) => {
  // ベータは DLsite にしか作品が無い
  await page.goto("/voice-actors/e2e-beta");
  await expect(page.getByRole("heading", { level: 2, name: "Audible" })).toBeVisible();
  // 空のストアは複数ある (Audible とポケドラ)。ストア名が入る空表示の文言で Audible だけを指す
  await expect(page.getByText("Audible で見つかった作品はありません")).toBeVisible();
});

test("作品が 1 件も無い声優は 404 になり、一覧にも sitemap にも出ない", async ({ request }) => {
  // DB には AniList 由来の 2,500 人が入るが、ページを作るのは作品がある人だけ
  const page = await request.get("/voice-actors/e2e-gamma");
  expect(page.status()).toBe(404);

  const directory = await request.get("/voice-actors");
  expect(await directory.text()).not.toContain("テスト声優ガンマ");

  const sitemap = await request.get("/sitemap.xml");
  const xml = await sitemap.text();
  expect(xml).toContain("/voice-actors/e2e-alpha");
  expect(xml).not.toContain("/voice-actors/e2e-gamma");
});
