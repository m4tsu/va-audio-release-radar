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
  /**
   * Web Push の VAPID 公開鍵 (base64url)。ブラウザが購読を作るときにこの鍵を渡す (`@/app/server-fns/push`)。
   * HTML に出る公開鍵なので秘匿値ではなく wrangler.jsonc の `vars` に置く。
   * 空文字なら未設定として、通知の案内を画面に出さない
   */
  VAPID_PUBLIC_KEY?: string;
  /**
   * 対になる秘密鍵。wrangler secret で持つ。送信 (ダイジェストの cron) が署名に使う。
   * 購読の登録だけなら要らない
   */
  VAPID_PRIVATE_KEY?: string;
  /**
   * 送信時に push service へ名乗る連絡先 (`mailto:` か `https:` の URL)。秘匿値ではなく
   * wrangler.jsonc の `vars` に置く。秘密鍵と合わせて揃っていなければ送らない (`@/server/push/vapid`)
   */
  VAPID_SUBJECT?: string;
  /**
   * 検索エンジンに載せてよいか (`@/server/robots`)。`"1"` のときだけ許可する。
   * 秘匿値ではなく wrangler.jsonc の `vars` に置く。
   * **既定は載せない。** 公開前の URL が検索から拾われないようにするため
   */
  ALLOW_INDEXING?: string;
  /**
   * ストアごとのアフィリエイト ID (`@/server/affiliate`)。URL に出る公開値なので wrangler.jsonc の `vars` に置く。
   * 空文字なら未設定として、そのストアへは正規 URL で送る
   */
  DLSITE_AFFILIATE_ID?: string;
  AUDIBLE_AFFILIATE_ID?: string;
  /** バリューコマースのサイト ID (`sid`)。バリューコマース経由の広告 (ポケドラ、Audible の無料体験) で共通 */
  VALUECOMMERCE_SID?: string;
  /** ポケドラの作品リンク (MyLink) の広告スペース ID (`pid`)。`VALUECOMMERCE_SID` と揃ったときだけ組み立てる */
  POKEDORA_VC_PID?: string;
  /** Audible の無料体験のテキストリンクの広告スペース ID (`pid`)。同じく `VALUECOMMERCE_SID` と揃ったときだけ出す */
  AUDIBLE_TRIAL_VC_PID?: string;
  /**
   * クエリ結果のキャッシュ (`@/server/data-cache`) を使うか。`"1"` のときだけ使う。
   * 秘匿値ではなく wrangler.jsonc の `vars` に置き、本番の値は package.json の deploy が渡す
   */
  DATA_CACHE?: string;
}

export {};
