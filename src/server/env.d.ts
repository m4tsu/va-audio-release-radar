/**
 * wrangler secret / `.dev.vars` から注入される秘匿値の型 (設計書 §6)。
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
}

export {};
