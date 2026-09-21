/**
 * wrangler secret / `.dev.vars` から注入される秘匿値の型。
 *
 * `worker-configuration.d.ts` は `wrangler types` の生成物で、wrangler.jsonc に書いた
 * バインディング (DB) しか載らない。secret はここで宣言のマージで足す。
 * 未設定を型で表せるよう必ず optional にする (未設定なら該当機能は 503)。
 *
 * `cloudflare:workers` の `env` は `Cloudflare.Env` 型なのでそちらを拡張する。
 * ハンドラ引数などで使う素の `Env` も同じ形に揃えておく。
 *
 * 注意: `.dev.vars` を置いた状態で `npm run cf-typegen` を実行すると生成側にも同名の
 * プロパティが必須の `string` で現れ、宣言のマージに失敗する。その場合はこのファイルを消す
 */
declare global {
  namespace Cloudflare {
    interface Env extends AppSecrets {}
  }
  interface Env extends AppSecrets {}
}

interface AppSecrets {
  /** クローラーが POST /api/admin/ingest と POST /api/admin/actors を叩く Bearer トークン */
  INGEST_TOKEN?: string;
  /** 管理画面 (/admin/*) と管理系 server function のトークン */
  ADMIN_TOKEN?: string;
  /**
   * canonical / og:url / sitemap を絶対 URL にするときのオリジン (`@/server/site`)。
   * 秘匿値ではなく wrangler.jsonc の `vars` に置く。空文字なら未設定としてリクエストのオリジンを使う
   */
  SITE_URL?: string;
  /**
   * 利用規約・プライバシーポリシーに載せる外部の問い合わせ窓口 (`https:` の URL か `mailto:`)。
   * wrangler.jsonc の `vars` に置く。空文字なら未設定として、窓口の案内を出さない
   * (サイト内のお問い合わせ画面への案内は設定の有無に関わらず出る)
   */
  CONTACT_URL?: string;
  /**
   * お問い合わせ画面の bot 対策 (Cloudflare Turnstile) の画面側の鍵 (`@/server/turnstile`)。
   * HTML に出る公開鍵なので秘匿値ではなく wrangler.jsonc の `vars` に置く
   */
  TURNSTILE_SITE_KEY?: string;
  /** 同じく検証側の鍵。wrangler secret で持つ。未設定なら送信は 503 */
  TURNSTILE_SECRET_KEY?: string;
}

export {};
