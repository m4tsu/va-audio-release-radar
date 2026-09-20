import { expect, test } from "@playwright/test";

/**
 * サーバーが返す HTML そのもの。ブラウザを開かず `request` だけで見る。
 *
 * ここに置くのは loader と head の出力 (本文・title・meta・canonical・JSON-LD・状態コード)。
 * 画面の見た目と操作は jsdom のページテスト (`src/app/pages/**`) が見るので置かない
 */

const ACTOR_SLUG = "e2e-alpha";
const ACTOR_NAME = "テスト声優アルファ";
/** sitemap と同じ形 (コロンを %3A に符号化した作品 ID) */
const WORK_PATH = "/works/dlsite%3ARJ90000001";

test("トップは JS を動かす前の HTML に新着が入っている", async ({ request }) => {
  const res = await request.get("/");
  expect(res.status()).toBe(200);

  const html = await res.text();
  expect(html).toContain("新着の音声作品");
  // 描画されるのは既定のタブ (DLsite) だけ。ハイドレーション用のデータではなく
  // 描画済みのマークアップ (リンク) に入っていることを見る
  expect(html).toMatch(/<a[^>]*>テスト用ASMR作品アルファ<\/a>/);
  expect(html).not.toMatch(/<a[^>]*>テスト用朗読作品アルファ<\/a>/);
  expect(html).toMatch(/href="\/voice-actors\/e2e-alpha"/);
});

test("声優ページは title と本文と canonical を SSR で返す", async ({ request, baseURL }) => {
  const res = await request.get(`/voice-actors/${ACTOR_SLUG}`);
  expect(res.status()).toBe(200);

  const html = await res.text();
  expect(html).toContain(
    `<title>${ACTOR_NAME}の音声作品 (ASMR・朗読・ボイスドラマ) | DLsite・Audible・ポケットドラマCD</title>`,
  );
  expect(html).toContain(`${ACTOR_NAME}が出演する ASMR・朗読・ボイスドラマを`);
  // 作品名が生 HTML に含まれる = 検索エンジンが中身を読める
  expect(html).toMatch(new RegExp(`<h1[^>]*>${ACTOR_NAME}の音声作品</h1>`));
  expect(html).toMatch(/<h2[^>]*>DLsite<\/h2>/);
  expect(html).toMatch(/<a[^>]*>テスト用ASMR作品アルファ<\/a>/);
  // canonical と og:url は絶対 URL (SITE_URL 未設定ならリクエストのオリジン)。
  // オリジンは baseURL から取る。ポートを直書きすると playwright.config.ts を変えた途端に落ちる
  expect(html).toContain(`<link rel="canonical" href="${baseURL}/voice-actors/${ACTOR_SLUG}"/>`);
  expect(html).toContain(
    `<meta property="og:url" content="${baseURL}/voice-actors/${ACTOR_SLUG}"/>`,
  );
  expect(html).toContain('"@type":"Person"');
});

test("JSON-LD は < をエスケープして出す", async ({ request }) => {
  const html = await (await request.get(`/voice-actors/${ACTOR_SLUG}`)).text();

  // ld+json の中身に生の "<" が残っていると、名前に "</script>" を含む声優で要素が閉じる
  const jsonLd = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
  expect(jsonLd).toBeDefined();
  expect(jsonLd).not.toContain("<");
  expect(JSON.parse(jsonLd ?? "{}")["@type"]).toBe("Person");
});

test("作品が 1 件も無い声優は 404 になり、一覧にも sitemap にも出ない", async ({ request }) => {
  // DB には AniList 由来の 2,500 人が入るが、ページを作るのは作品がある人だけ
  const page = await request.get("/voice-actors/e2e-gamma");
  expect(page.status()).toBe(404);

  const directory = await request.get("/voice-actors");
  expect(await directory.text()).not.toContain("テスト声優ガンマ");

  const xml = await (await request.get("/sitemap.xml")).text();
  expect(xml).toContain("/voice-actors/e2e-alpha");
  expect(xml).not.toContain("/voice-actors/e2e-gamma");
});

/**
 * 既定の並びはサーバーが返した HTML の時点で付いている。
 * クライアントが動き出してから並び替わると、最初に目に入る順が別物になる
 */
test("声優一覧はサーバーが返す HTML の時点で作品数の多い順", async ({ request }) => {
  const html = await (await request.get("/voice-actors")).text();
  const position = (slug: string) => html.indexOf(`href="/voice-actors/${slug}"`);

  expect(position("e2e-delta")).toBeGreaterThan(-1);
  expect(position("e2e-delta")).toBeLessThan(position("e2e-alpha"));
  expect(position("e2e-alpha")).toBeLessThan(position("e2e-beta"));

  // 並び替えの操作も、作品数の多い順を選んだ状態で返っている
  expect(html).toContain('aria-label="並び替え: 作品数の多い順"');
});

/** 作品 ID はコロンを含む。符号化されたまま来ても loader が復号して引ける */
test("符号化された作品 ID の URL でも本文と canonical が返る", async ({ request, baseURL }) => {
  const res = await request.get(WORK_PATH);
  expect(res.status()).toBe(200);

  const html = await res.text();
  expect(html).toMatch(/<h1[^>]*>テスト用ASMR作品アルファ<\/h1>/);
  expect(html).toContain(`<link rel="canonical" href="${baseURL}${WORK_PATH}"/>`);
});

test("利用規約とプライバシーポリシーは SSR で本文まで返る", async ({ request }) => {
  const terms = await request.get("/terms");
  expect(terms.status()).toBe(200);
  expect(await terms.text()).toContain("第1条 (本規約の適用)");

  const privacy = await request.get("/privacy");
  expect(privacy.status()).toBe(200);
  expect(await privacy.text()).toContain("1. 基本方針");
});

test("/anime はデータのある最新シーズンへ送る", async ({ request }) => {
  const res = await request.get("/anime");
  expect(res.status()).toBe(200);
  expect(res.url()).toMatch(/\/anime\/season\/\d{4}-(winter|spring|summer|fall)$/);
  expect(await res.text()).toMatch(/<h1[^>]*>[^<]*アニメ<\/h1>/);
});

test("/admin/* は noindex", async ({ request }) => {
  const res = await request.get("/admin/crawler-health");
  expect(await res.text()).toContain('content="noindex"');
});
