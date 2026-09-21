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

/**
 * 出演形態の絞り込みは URL の検索文字列に置いてある。絞った画面を共有・再読み込みできるかは
 * 「その URL に GET した応答が絞り込み済みか」なので、ここでしか確かめられない。
 * 固定データのアルファの作品は 2〜3 人で、単独の作品は 1 件も無い
 */
test("出演形態の絞り込みは URL から復元され、SSR の HTML に反映される", async ({ request }) => {
  const all = await (await request.get(`/voice-actors/${ACTOR_SLUG}`)).text();
  expect(all).toMatch(/<a[^>]*>テスト用ASMR作品アルファ<\/a>/);

  const small = await (await request.get(`/voice-actors/${ACTOR_SLUG}?appearance=small`)).text();
  expect(small).toMatch(/<a[^>]*>テスト用ASMR作品アルファ<\/a>/);

  const solo = await (await request.get(`/voice-actors/${ACTOR_SLUG}?appearance=solo`)).text();
  expect(solo).not.toMatch(/<a[^>]*>テスト用ASMR作品アルファ<\/a>/);
  // 0 件になったことが画面に出る (ストアに作品が無いときとは別の文言)
  expect(solo).toContain("DLsite にこの出演形態の作品はありません");
});

/** 知らない値で 0 件にすると、共有された URL が壊れて見える */
test("読めない出演形態の値は絞り込み無しとして扱う", async ({ request }) => {
  const html = await (await request.get(`/voice-actors/${ACTOR_SLUG}?appearance=zzz`)).text();

  expect(html).toMatch(/<a[^>]*>テスト用ASMR作品アルファ<\/a>/);
});

test("JSON-LD は < をエスケープして出す", async ({ request }) => {
  const html = await (await request.get(`/voice-actors/${ACTOR_SLUG}`)).text();

  // ld+json の中身に生の "<" が残っていると、名前に "</script>" を含む声優で要素が閉じる
  const jsonLd = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
  expect(jsonLd).toBeDefined();
  expect(jsonLd).not.toContain("<");
  expect(JSON.parse(jsonLd ?? "{}")["@type"]).toBe("Person");
});

/**
 * 音声作品がまだ 1 件も無い声優のページ。フォローの入口として 200 で返しつつ、
 * 検索エンジンには載せない (`docs/decisions/0012-follow-actors-without-works.md`)
 */
test("作品が 1 件も無い声優は 200 と noindex で返り、一覧に出て sitemap に出ない", async ({
  request,
}) => {
  const page = await request.get("/voice-actors/e2e-gamma");
  expect(page.status()).toBe(200);

  const html = await page.text();
  expect(html).toContain('content="noindex"');
  expect(html).toContain("音声作品はまだ見つかっていません");
  // 名前と出演アニメは出る。フォローの前に人を確かめられるようにするため
  expect(html).toMatch(/<h1[^>]*>テスト声優ガンマの音声作品<\/h1>/);
  expect(html).toContain('href="/anime/e2e-anime-alpha"');

  const directory = await request.get("/voice-actors");
  expect(await directory.text()).toContain("テスト声優ガンマ");

  const xml = await (await request.get("/sitemap.xml")).text();
  expect(xml).toContain("/voice-actors/e2e-alpha");
  expect(xml).not.toContain("/voice-actors/e2e-gamma");
});

/** 作品のある声優のページの指定は変わらない。ここが noindex になると流入が止まる */
test("作品がある声優のページは noindex にならない", async ({ request }) => {
  const html = await (await request.get(`/voice-actors/${ACTOR_SLUG}`)).text();

  expect(html).not.toContain('content="noindex"');
});

test("作品も出演アニメも無い声優は 404 で、一覧にも sitemap にも出ない", async ({ request }) => {
  const page = await request.get("/voice-actors/e2e-epsilon");
  expect(page.status()).toBe(404);

  // 一覧は声優ページへのリンクを並べる場所。404 になるページへは送らない
  const directory = await request.get("/voice-actors");
  expect(await directory.text()).not.toContain("テスト声優イプシロン");

  const xml = await (await request.get("/sitemap.xml")).text();
  expect(xml).not.toContain("/voice-actors/e2e-epsilon");
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

/**
 * 入力欄が SSR の HTML に入っていること。
 * ハイドレーション前でも何を書く場所なのかが読め、JS を切っていても欄が見える
 */
test("/contact は入力欄を SSR で返す", async ({ request }) => {
  const res = await request.get("/contact");
  expect(res.status()).toBe(200);

  const html = await res.text();
  expect(html).toMatch(/<h1[^>]*>お問い合わせ<\/h1>/);
  expect(html).toContain("<textarea");
  expect(html).toContain("<select");
  expect(html).toMatch(/<button[^>]*>送信する<\/button>/);
});

test("/anime は転送せず、先頭のシーズンのアニメを JS を動かす前の HTML に入れている", async ({
  request,
}) => {
  const res = await request.get("/anime");
  expect(res.status()).toBe(200);
  expect(res.url()).toMatch(/\/anime$/);

  const html = await res.text();
  expect(html).toMatch(/<h1[^>]*>アニメから探す<\/h1>/);

  // 固定データが持つシーズンは 2026 年秋の 1 つだけ (e2e/fixtures/seed.sql)。
  // 先頭に出るのは放送中のシーズンか、そこに作品が無ければいちばん近いシーズンなので、
  // どちらに転んでもこの 1 つに落ちる。テストが特定の日付でしか通らなくならない
  expect(html).toContain("2026 年秋アニメ");
  expect(html).toMatch(/<a[^>]*href="\/anime\/e2e-anime-beta"/);
  expect(html).toContain("テストアニメベータ");
  expect(html).toContain("このシーズンをすべて見る");
});

test("シーズンの一覧は SSR で作品まで返す", async ({ request }) => {
  const res = await request.get("/anime/season/2026-fall");
  expect(res.status()).toBe(200);

  const html = await res.text();
  expect(html).toMatch(/<h1[^>]*>2026 年秋アニメ<\/h1>/);
  expect(html).toContain('href="/anime/e2e-anime-alpha"');
  // フォローはブラウザにしか無い。SSR の応答に印も絞り込みも入らない
  expect(html).not.toContain("フォロー中の声優が出演");
  expect(html).not.toContain("フォロー中の声優が出ている作品だけ");
});

/** 「声優一覧はサーバーが返す HTML の時点で作品数の多い順」と同じ理由 */
test("シーズンの一覧はサーバーが返す HTML の時点で人気順", async ({ request }) => {
  const html = await (await request.get("/anime/season/2026-fall")).text();
  const position = (slug: string) => html.indexOf(`href="/anime/${slug}"`);

  // ベータの方が人気度が高い (e2e/fixtures/seed.sql)
  expect(position("e2e-anime-beta")).toBeGreaterThan(-1);
  expect(position("e2e-anime-beta")).toBeLessThan(position("e2e-anime-alpha"));

  // 並び替えの操作も、人気順を選んだ状態で返っている
  expect(html).toContain('aria-label="並び替え: 人気順"');
});

/**
 * 音声作品がある出演者が 1 人も居ないアニメ。声優ページの「出演アニメ」から入れる必要があるので
 * 200 で返しつつ、検索エンジンには載せない
 */
test("音声作品がある出演者が居ないアニメは 200 と noindex で返り、sitemap に出ない", async ({
  request,
}) => {
  const res = await request.get("/anime/e2e-anime-gamma");
  expect(res.status()).toBe(200);

  const html = await res.text();
  expect(html).toContain('content="noindex"');
  expect(html).toContain("テストキャラガンマ2");

  const xml = await (await request.get("/sitemap.xml")).text();
  expect(xml).toContain("/anime/e2e-anime-alpha");
  expect(xml).not.toContain("/anime/e2e-anime-gamma");
});

/** 音声作品がある出演者が居るアニメのページの指定は変わらない */
test("音声作品がある出演者が居るアニメは noindex にならない", async ({ request }) => {
  const html = await (await request.get("/anime/e2e-anime-alpha")).text();

  expect(html).not.toContain('content="noindex"');
  // キャストには音声作品が無い出演者も並ぶ
  expect(html).toContain("テスト声優ガンマ");
  expect(html).toContain("音声作品はまだありません");
});

test("sitemap にアニメの索引とシーズンの一覧が並ぶ", async ({ request }) => {
  const xml = await (await request.get("/sitemap.xml")).text();

  expect(xml).toContain("<loc>http");
  expect(xml).toMatch(/<loc>[^<]*\/anime<\/loc>/);
  expect(xml).toMatch(/<loc>[^<]*\/anime\/season\/2026-fall<\/loc>/);
});

test("/admin/* は noindex", async ({ request }) => {
  const res = await request.get("/admin/crawler-health");
  expect(await res.text()).toContain('content="noindex"');
});
