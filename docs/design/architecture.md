# アーキテクチャ設計 (MVP)

Date: 2026-09-18
Status: 決定済み。実装エージェントはこの文書に従う。企画は `docs/development-plan.md`。

## 1. 決定事項

| 項目 | 決定 | 理由 |
|---|---|---|
| フロント / SSR | TanStack Start (React 19, Vite) | `/voice-actors/{slug}` を検索エンジンにインデックスさせるため SSR が必要。TanStack Router からの延長で参照プロジェクトの構成を維持できる |
| 配信 | Cloudflare Workers (`@cloudflare/vite-plugin`) | 参照プロジェクトと同じ |
| DB | Cloudflare D1 (SQLite) + Drizzle ORM | ユーザー決定。PostgreSQL は使わない |
| クローラー | Node.js 24 + TypeScript (型のみ剥がして直接実行)、cheerio | 企画書どおり。Worker 内では実行しない (Cloudflare からの egress ブロック回避、サブリクエスト上限回避) |
| クローラーの DB 書き込み | Worker の `POST /api/admin/ingest` (Bearer トークン) に正規化済み JSON を送る | DB アクセスコードを Worker 側 1 箇所に集約する。ローカルの `vite dev` にも同じ経路で流せる |
| スケジューラ | GitHub Actions cron (毎日 1 回) | 企画書どおり。ローカル手動実行も同じスクリプト |
| フォロー状態 | ブラウザ内保存 (Zustand + Dexie)。アカウント無し | 企画書 §16 |
| UI | Tailwind v4 + shadcn/ui (`src/app/components/ui` に同梱) | 参照プロジェクトと同じ |
| Lint / Test | Biome / Vitest / Playwright | 参照プロジェクトと同じ |

導入しないもの: 認証、Redis、キュー、AI 推薦、成人向け作品、別名の推測マージ。

## 2. ディレクトリ構成と依存方向

```
crawler/                 # Node スクリプト。src/domain にだけ依存する (src/app, src/server は禁止)
├── adapters/            # dlsite.ts, audible.ts (ストアごとに分離。SourceAdapter を実装)
├── fixtures/            # 実 HTML / JSON を切り詰めた固定データ (パーサーのテスト用)
├── lib/                 # fetch ラッパー (レート制限・スナップショット保存)、ingest クライアント
├── actors.json          # 追跡する声優のシードリスト (35 人。id は `va_{slug}`)
├── cli.ts               # 調査用。`node crawler/cli.ts actor "上田麗奈"` / `diff`
├── run.ts               # 定期実行の本体。`node crawler/run.ts --base-url ...` (GitHub Actions もこれを叩く)
└── *.test.ts
migrations/              # drizzle-kit が生成する SQL。wrangler d1 migrations apply で適用
src/
├── domain/              # 純粋な型・正規化・名寄せ。React / DB / fetch に依存しない
├── server/              # Worker 側でだけ動くコード (D1 アクセス、server functions の実装)
│   ├── db/schema.ts     # Drizzle スキーマ
│   ├── db/client.ts     # env.DB から drizzle を作る
│   └── queries/         # 画面ごとの読み取り、ingest の upsert
├── app/                 # React
│   ├── routes/          # TanStack Start のファイルベースルート (SSR)
│   ├── features/        # 画面ごとの部品
│   ├── components/      # 共通 UI (ui/ は shadcn 生成物)
│   ├── store/           # フォロー状態 (Zustand + Dexie)
│   └── lib/
├── router.tsx           # TanStack Start が読む createRouter
└── index.css
```

依存方向: `app → server → domain`、`crawler → domain`。逆方向は Biome の `noRestrictedImports` で禁止する。
`src/server/**` は `.server.ts` の命名にせず、server functions (`createServerFn`) の handler からのみ import する。

## 3. データ取得の調査結果 (2026-09-18 に確認)

### DLsite (全年齢 = `home`)

- 検索 (声優名で絞り込み、音声カテゴリ、新着順):
  `https://www.dlsite.com/home/fsr/=/language/jp/keyword_creater/"{名前}"/work_type_category[0]/audio/order/release_d/page/1`
  (名前はダブルクォートで囲んで URL エンコード。完全一致になる。`per_page/100` は 0 件になったので使わない。既定 30 件/ページ)
- robots.txt: `/*/fsr/=/*/per_page/*/page/` は不許可、`.../page/1/` のみ許可。**Crawl-delay: 10**。検索は 1 ページ目だけ取る
- 一覧 HTML の構造 (サーバー側描画済み):
  - `ul#search_result_img_box > li[data-list_item_product_id="RJ..."]`
  - `dd.work_name a[href]` にタイトルと商品 URL (`https://www.dlsite.com/home/work/=/product_id/RJ....html`)
  - `dd.maker_name > a` にサークル名、`span.author a` に声優名
  - `dd.work_price_wrap .work_price .work_price_base` に現在価格 (`1,584`)、`span.strike .work_price_base` に定価
  - `div.work_category` の class `type_SOU` が作品種別 (SOU = ボイス・ASMR)
  - 画像: `thumb-with-ng-filter-block[:thumb-candidates]` 内の `//img.dlsite.jp/.../RJ..._img_main_240x240.jpg`
  - **一覧に発売日は無い**
- 作品詳細 JSON: `https://www.dlsite.com/home/api/=/product.json?workno=RJ01698658` → 配列 1 件。
  使う項目: `workno, work_name, maker_name, maker_id, regist_date ("2026-08-22 00:00:00"), age_category (1 = 全年齢), age_category_string ("general"), work_type ("SOU"), work_type_string, price, official_price, image_main.file_name, creaters.voice_by[].name, genres[].name, on_sale, site_id`。
  カンマ区切りで複数 workno を渡すと空配列になった (単発のみ確実)
- 商品 URL (正規): `https://www.dlsite.com/home/work/=/product_id/{workno}.html`
- 画像 URL: `https://img.dlsite.jp/modpub/images2/work/doujin/{切り上げ千番台 例 RJ01699000}/{workno}_img_main.jpg`。一覧の `thumb-candidates` から取るのが確実
- 一覧の `span.author` は代表 1 名だけ。声優全員は `product.json` の `creaters.voice_by` から取る (必須)
- 表紙の原寸 URL: `thumb-candidates` の `resize/images2` → `modpub/images2`、`_240x240.jpg` → `.jpg` に置換 (T2 が 200 を確認)
- 方針: 検索 1 ページ目 (最新 30 件) で ID を集め、DB に無い ID だけ `product.json` を 1 件ずつ取る。リクエスト間隔は検索 10 秒、product.json 2 秒

### Audible Japan

- 検索: `https://www.audible.co.jp/search?searchNarrator={名前}&sort=pubdate-desc-rank` (`sort` を単独で付けると HTTP 200 のまま発売日降順になる。既定 (sort 無し) は人気順 (popularity-rank) で、20 件を超える声優 (例: 石田彰は 38 件) は新作が 1 ページ目に載らないことがあるため付ける。`pageSize` や `page` を追加すると `no-search-results` へ 302 された)
- robots.txt: `searchNarrator=` に `page=` や `node=` を組み合わせたものは不許可。1 ページ目 (20 件) だけ取る制約は残る。総件数は「検索結果 N のうち…」の表示から取り、20 を超えるときは adapter が警告を積む (企画書 §21)
- `/no-search-results?keywords=null` への 302 は**「ナレーター検索に該当なし」の意味** (T2 が確認: 存在しない名前でも同じ 302、直後に別名で 200。頻度制限ではなかった)。adapter はこれを `status: "empty"` (成功・0 件) として返し、ingest 側は `crawl_runs.work_count = 0` で記録する。既存の listing / credit は消さないので、制限と混同しても被害は出ない。前回 > 0 から 0 への急減は管理画面の警告で拾う (§21)
- ブラウザ相当の `User-Agent` と `Accept-Language: ja-JP` を送り、リクエスト間隔は 6 秒
- ナレーター表記は作品ごとに「上田 麗奈」「上田麗奈」と揺れる。表記のまま `creditedNames` に入れ、名寄せ (`normalizeName`) で吸収する
- `searchNarrator=` 自体も検索語の空白の有無で結果が変わる名前がある (実測: 「石見舞菜香」は空白なしだと `no-search-results` へ 302、空白ありの「石見 舞菜香」だと 2 件)。crawler は `actors.json` の検証済み空白入り alias を先に試し、無ければ canonicalName で検索する (T8)
- 本文側の `li` には `narratorLabel` / `authorLabel` / `runtimeLabel` / `releaseDateLabel` クラスが付く。flyout 側には付かず「、その他」で省略されるため、本文側だけを使う
- ポッドキャストが混ざることがあり、配信日・再生時間が無い。除外せず保存する (releaseDate なし)
- 一覧 HTML: `li.productListItem[id="product-list-item-{ASIN}"]` (`aria-label` にタイトル)
  - タイトルリンク: `h3 a` または `a[href^="/pd/"]` (href に `/pd/{slug}/{ASIN}`)
  - `著者：` の後の `a` 群、`ナレーター：` の後の `a` 群 (全員分。名前は「上田 麗奈」のように姓名の間に空白)
  - `再生時間： 9 時間  6 分`、`配信日： 2024/06/28`、`シリーズ：`、価格 `￥2,690`
  - 表紙: `img.bc-image-inset-border[src]` (`https://m.media-amazon.com/images/I/....jpg`)
  - `li.productListItem` の中に flyout (popover) が含まれ、同じ情報が重複する。本文側のラベル (`ナレーター：` 直後の `a`) を優先する
- 商品 URL (正規): `https://www.audible.co.jp/pd/{ASIN}`

### AniList

- `POST https://graphql.anilist.co` `{ Staff(search:"上田麗奈"){ id name{ full native } } }` → id 118602。認証不要。任意の補助レイヤー (MVP では staffId をシードに手で入れる程度)

## 4. ドメインモデル (`src/domain/types.ts`)

企画書 §8 を D1 向けに確定したもの。日時は ISO 8601 文字列 (UTC)。ID は文字列。

```ts
export type StoreSlug = "dlsite" | "audible";            // Phase 2 で "pokedora" | "audiobookjp"
export type WorkCategory = "asmr" | "audio_drama" | "audiobook" | "situation_voice" | "other";
export type CreditConfidence = "verified" | "probable" | "unmatched";

export type VoiceActor = {
  id: string;                 // 例 "va_ueda-reina" (slug 由来。シードで固定)
  slug: string;               // URL 用。ローマ字小文字ハイフン ("ueda-reina")
  canonicalName: string;      // "上田麗奈"
  nameKana?: string;          // "うえだれいな"
  anilistStaffId?: number;
  imageUrl?: string;
  status: "active" | "inactive" | "unknown";
};

export type VoiceActorAlias = {
  voiceActorId: string;
  name: string;               // "上田 麗奈" など公開されている表記揺れのみ
  source: "manual" | "anilist" | "store";
  verified: boolean;
};

export type AudioWork = {
  id: string;                 // "{storeSlug}:{storeProductId}" (MVP ではストア横断マージをしない)
  title: string;
  category: WorkCategory;
  releaseDate?: string;       // "YYYY-MM-DD"
  coverImageUrl?: string;
  durationSeconds?: number;
  adult: boolean;             // MVP では常に false の作品だけ保存する
  makerName?: string;         // サークル / 出版社
};

export type StoreListing = {
  audioWorkId: string;
  storeSlug: StoreSlug;
  storeProductId: string;     // "RJ01698658" / ASIN
  productUrl: string;         // 正規 URL。アフィリエイト URL は別項目
  affiliateUrl?: string;
  titleRaw: string;
  price?: number;             // JPY
  listPrice?: number;         // 定価 (セール時に price と異なる)
  available: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type AudioCredit = {
  audioWorkId: string;
  voiceActorId?: string;      // 未解決なら undefined
  creditedName: string;       // ストア上の表記そのまま
  role?: string;
  confidence: CreditConfidence;
  sourceStoreSlug: StoreSlug;
};

/** クローラーの adapter が返す正規化前の 1 作品 */
export type RawWork = {
  storeSlug: StoreSlug;
  storeProductId: string;
  titleRaw: string;
  productUrl: string;
  coverImageUrl?: string;
  releaseDate?: string;       // "YYYY-MM-DD"
  durationSeconds?: number;
  price?: number;
  listPrice?: number;
  makerName?: string;
  creditedNames: string[];    // 声優 / ナレーターとして表記されている名前 (全員)
  storeCategory?: string;     // "SOU" / "audiobook" などストア固有の分類
  genres?: string[];
  adult: boolean;
  fetchedAt: string;
};

/** ingest エンドポイントの入力 */
export type IngestPayload = {
  runId: string;
  storeSlug: StoreSlug;
  voiceActorId: string;       // このクロールの対象声優
  works: RawWork[];
  error?: string;             // 取得失敗時 (works は空)
};
```

### 名寄せ (`src/domain/identity.ts`) — 企画書 §9

純粋関数 `resolveCredit(creditedName, actors, aliases) → { voiceActorId?, confidence }`:

1. `creditedName === canonicalName` → verified
2. `creditedName === alias.name` かつ `alias.verified` → verified
3. `normalizeName(creditedName) === normalizeName(canonicalName or alias)` → verified
   (`normalizeName`: NFKC 正規化、空白・中黒・記号の除去、全角英数→半角。かな⇄カナ変換はしない)
4. それ以外 → unmatched (`voiceActorId` 無し)。管理画面の未解決キューに出す

LLM や類似度による推測マージはしない。

### カテゴリ判定 (`src/domain/category.ts`)

`categorize(storeSlug, storeCategory, genres, titleRaw) → WorkCategory`。

#### 実データの集計 (2026-09-18, `crawler/.cache/snapshots/dlsite/` の product.json 200 件)

`work_type` は **200 件すべて `SOU`**。全年齢音声で他の種別はほぼ出てこない。ジャンルの上位 20 件:

| 件数 | ジャンル | 件数 | ジャンル |
|---:|---|---:|---|
| 155 | ASMR | 21 | ほのぼの |
| 138 | バイノーラル/ダミヘ | 18 | 添い寝 |
| 134 | 癒し | 18 | ラブコメ |
| 109 | 耳かき | 18 | 百合 |
| 65 | 萌え | 12 | シリーズもの |
| 64 | ささやき | 12 | マッサージ |
| 46 | 日常/生活 | 12 | ネコミミ |
| 40 | ラブラブ/あまあま | 11 | 先輩/後輩 |
| 29 | 健全 | 10 | 歴史/時代物 |
| 24 | 人外娘/モンスター娘 | 9 | 制服 |
| 24 | 学校/学園 | | |

この集計で分かったこと:

- DLsite のジャンルに「ドラマ」「シチュエーション」という語は **1 件も無い**。旧規則 (ジャンルだけを見る) では 200 件すべてが asmr になっていた
- ドラマ作品を見分けられるのは **タイトルだけ**。「ボイスドラマ」「ドラマCD」を含むタイトルが 19 件あった (例: 『【百合ボイスドラマ】りりくる』、『ドラマCD 聖闘士星矢 冥王異伝』)
- ジャンルが空の作品が 9 件ある (セット商品など)。その 9 件はすべてタイトルに「ASMR」が入っていた
- 「ささやき」はひらがな、「バイノーラル/ダミヘ」はスラッシュ付きなど、ジャンル名の表記は固定されている

#### 採用した規則

判定材料をジャンル + タイトルに広げ、上から順に当てる:

1. Audible → audiobook (朗読以外の判定はしない)
2. DLsite の `work_type` が `SOU` 以外 (`MUS` など) / 不明 → other
3. ジャンルかタイトルに「ボイスドラマ」「ドラマCD」「オーディオドラマ」→ **audio_drama**
4. ジャンルに「ドラマ」を含む語 → **audio_drama** (DLsite が将来ジャンルを持った場合の受け)
5. ジャンルかタイトルに ASMR 系の語 (ASMR / 耳かき / 耳ふー / 耳舐め / ささやき / 囁き / バイノーラル / ダミヘ / 安眠 / 睡眠 / 添い寝 / マッサージ / 催眠音声) → **asmr**
6. ジャンルかタイトルに「シチュエーション」「シチュボ」→ **situation_voice**
7. どれにも当たらなければ **asmr** (DLsite 全年齢音声の大半が ASMR のため)

3 を 5 より先に見るのは、「ASMR」ジャンルが付いたボイスドラマがあるため。逆に「【ASMRおやすみドラマ】…」のようにタイトルへ「ドラマ」だけが入る ASMR 作品もあるので、タイトル側では複合語 (ボイスドラマ / ドラマCD) しか拾わない。

この規則を 200 件に当てると **asmr 181 / audio_drama 19**。既知の取りこぼしは「歴史/時代物」だけが付いた連作ドラマ (『幕末動乱美少女伝』など 8 件) で、ジャンルにもタイトルにもドラマを示す語が無いため asmr に落ちる。

ingest 側は「ジャンル情報があるときだけカテゴリを更新する」挙動を維持する (`--skip-known` で詳細を取らなかった作品の分類を既定値で潰さないため)。

## 5. DB スキーマ (Drizzle, SQLite)

テーブル名は snake_case。`created_at` / `updated_at` は ISO 文字列。

- `voice_actors(id PK, slug UNIQUE, canonical_name, name_kana, anilist_staff_id, image_url, status, created_at, updated_at)`
- `voice_actor_aliases(id PK autoinc, voice_actor_id FK, name, source, verified, UNIQUE(voice_actor_id, name))`
- `audio_works(id PK, title, category, release_date, cover_image_url, duration_seconds, adult, maker_name, created_at, updated_at)`
- `store_listings(id PK autoinc, audio_work_id FK, store_slug, store_product_id, product_url, affiliate_url, title_raw, price, list_price, available, first_seen_at, last_seen_at, last_checked_at, UNIQUE(store_slug, store_product_id))`
- `audio_credits(id PK autoinc, audio_work_id FK, voice_actor_id FK nullable, credited_name, role, confidence, source_store_slug, UNIQUE(audio_work_id, credited_name, source_store_slug))`
- `crawl_runs(id PK, store_slug, voice_actor_id, started_at, finished_at, work_count, new_count, status ("ok"|"error"), error)` — クローラー健全性 (企画書 §21)。前回比で件数が 0 に落ちたら管理画面で警告

インデックス: `audio_credits(voice_actor_id)`, `audio_works(release_date)`, `store_listings(audio_work_id)`, `crawl_runs(store_slug, voice_actor_id, started_at)`。

フォローはブラウザ内のみなので DB に無い。

## 6. HTTP / server functions

server functions (`createServerFn`) で画面データを取る。JSON API として外部に出すのは以下だけ。

| ルート | 用途 |
|---|---|
| `GET /api/health` | 稼働確認 `{ ok: true }` |
| `POST /api/admin/ingest` | クローラーからの取り込み。`Authorization: Bearer {INGEST_TOKEN}`。本文は `IngestPayload`。upsert 後 `{ upserted, new, unmatched }` を返す |
| `POST /api/admin/actors` | 声優シードの upsert。`crawler/actors.json` をそのまま送る。ingest と同じ Bearer |
| `GET /api/admin/known-ids?store=dlsite` | DB にある `store_product_id` の配列。DLsite の詳細取得を新規だけに絞るために使う。ingest と同じ Bearer |
| `GET /sitemap.xml` | 声優ページと作品ページの URL |
| `GET /robots.txt` | `/admin/` を Disallow |

ingest の処理: `RawWork` → `AudioWork` + `StoreListing` を upsert (`first_seen_at` は初回のみ)、`creditedNames` ごとに `resolveCredit` → `audio_credits` upsert、`crawl_runs` を 1 行追加。対象声優の名前が `creditedNames` に含まれない作品も保存はするが、その声優への credit は作らない (検索結果のノイズ対策)。

ingest の書き込みは `db.batch` にまとめる。順序は 作品 → listing → credit に固定する (後ろ 2 つが `audio_works` を外部キーで参照するため)。「今回はじめて見た listing か」は書き込む前に 1 回の `IN` クエリで判定する。

credit の upsert で名寄せ結果が unmatched のときは、既存行の `voice_actor_id` / `confidence` を上書きしない。管理画面で人が割り当てた行が再クロールのたびに剥がれるのを防ぐため。

`IN` 句に並べる値は必ず `src/server/db/chunked.ts` の `chunked()` で 90 件ずつに切る。D1 の bound parameter 上限は 100 で、超えると本番だけ実行時に落ちる (単体テストの libsql では通ってしまう)。

秘匿値 (wrangler secret): `INGEST_TOKEN`, `ADMIN_TOKEN`。未設定なら該当機能は 503。

`vars` (秘匿値ではない): `SITE_URL`。canonical / og:url / `sitemap.xml` / `robots.txt` の Sitemap 行を絶対 URL にするためのオリジン。空文字なら未設定として、実際に来たリクエストのオリジンを使う (`src/server/site.ts` の `siteOrigin()`)。`head()` は SSR とクライアントの両方で動くので、オリジンはローダーで解決して loaderData 経由で渡す。

`/admin/*?token=` は `ADMIN_TOKEN` と一致したときだけ HttpOnly cookie を立てる。一致しなければ cookie を触らず、トークンを落とした同じパスへ 303 で送り直すだけにする (応答の形で当たり外れを区別させない)。`token=` が空なら cookie を消す (ログアウト)。トークン比較は長さが違っても定数時間で回す。

ストアから取った `productUrl` / `coverImageUrl` は zod で `https:` の絶対 URL に限定する。描画側 (`src/app/lib/safe-url.ts` の `safeHttpsUrl()`) でももう一度絞る。検証を足す前に DB へ入った行が残りうるため。

## 7. 画面 (企画書 §13)

| パス | 内容 | SSR |
|---|---|---|
| `/` | 検索ボックス、フォロー中の声優の新着フィード (フォロー 0 件なら「最近の新着」と「声優一覧」) | 有 (フィード部分はクライアントでフォロー ID を読んでから server function を呼ぶ) |
| `/voice-actors/$slug` | 声優名、フォローボタン、ストアごとの最新作品リスト。`<title>` は「{名前}の新着音声作品 (DLsite / Audible)」 | 有。インデックス対象 |
| `/works/$id` | タイトル、表紙、クレジット、ストア別の価格と「DLsite で見る」「Audible で聴く」 | 有 |
| `/following` | フォロー中の声優一覧と解除 | 有 (中身はクライアント) |
| `/admin/unmatched-credits` | 未解決クレジットの一覧と手動割り当て (`?token=` で cookie を立てる) | 有 |
| `/admin/crawler-health` | `crawl_runs` の直近結果、件数急減の警告 | 有 |

デザインは参照プロジェクト (`~/workspase/multi-gacha-portfolio-planner`) と同じ neutral な shadcn テーマ。日本語 UI のみ (i18n は入れない)。

## 8. コーディング規約

- TypeScript strict、`noUncheckedIndexedAccess`、`erasableSyntaxOnly`。コメントは日本語で「なぜ」を書く
- Biome (`npm run lint`)。ダブルクォート、セミコロン、100 桁
- テスト: domain と crawler は node 環境の Vitest。adapter のパーサーは `crawler/fixtures/` の固定 HTML/JSON に対してテストする。ネットワークに出るテストは書かない
- 外部サイトへの fetch は `crawler/lib/fetch.ts` の 1 箇所を通す (UA、レート制限、スナップショット保存、タイムアウト 30 秒)
- 完了条件は常に `npm run check` (型・lint・単体テスト) と `npm run build` の通過

## 9. 対象声優の定義 (2026-09-18 ブレストで決定)

> **対象声優 = AniList にアニメ出演記録がある日本語声優のうち、DLsite 全年齢音声か Audible に作品がある人**

- 製品のコンセプトは「アニメ声優との接続」。DLsite にしか居ない同人 ASMR の声優はフォロー対象にしない (クレジット表記としては残す)
- 名前を人が挙げるのではなく、需要側 (AniList: 直近シーズンのアニメ → キャラクター → 日本語 voiceActors) と供給側 (DLsite: sitemap で全年齢音声作品を全件発見 → `voice_by`) の交差で機械的に決める。Audible は交差した名前で検索する
- 現在の `crawler/actors.json` (35 人) は、この仕組みができるまでの暫定シード
- GO / NO-GO で見る数字: 交差に入る声優の人数 (50 人未満なら薄い)、交差した声優の直近 90 日の新作数 / 週 (フィード密度)
- 一番危ない仮定: 「アニメ声優の全年齢 DLsite 作品が、フィードを維持できる頻度で出続けている」。発見スパイク (`docs/research/discovery-spike-*.md`) で数字を出して確認する

## 10. 「新着」の定義とフィードの構成 (2026-09-18 決定)

- **新着は発売日基準**。NEW バッジと「今週の新着」は `release_date` が 7 日以内。フィードの並びは発売日の降順
- **今後の発売**: `release_date` が未来の作品 (DLsite の予約) は別枠で先頭に出す (企画書 §5「今日以降の新着」)
- **発売日の無い作品** (Audible のポッドキャスト等) だけ、その声優の初回クロール (`crawl_runs` の最古の成功 run) 以降に見つかったものを新着扱いにする。初回クロールで見つかった分は新着にしない
- **利用者ごとの未読**: 最後にフィードを見た日時をブラウザ (Dexie) に保存し、それ以降に発売 / 発見された作品に未読の印を付ける。アカウント無しで企画書 §6 の「Mark seen」を実現する
- **フィードは 3 段**: 今後の発売 / 30 日以内の新作 / それ以前 (折りたたみ、直近 90 日)。上 2 段が空でも画面が空にならない
- `first_seen_at` だけで新着を判定しない (初回クロールと声優追加のたびに全作品が新着になるため)
- GO / NO-GO の「新作数 / 週」も発売日で数える (§9 の発見スパイクと定義を揃える)
- 要確認: Audible 検索の既定の並び順が発売日順か。20 件を超える声優で新作が 1 ページ目から漏れる可能性がある

## 11. 差別化の軸と通知の方針 (2026-09-18 決定。差別化案は引き続き検討中)

- **差別化の軸**: 「フォローした声優の新着を、ストアを問わず取りこぼさず知らせる」。ストア横断はその実現手段の 1 つで、Audible は中核ではなく 2 号ストア。対応ストアを増やせる構造 (adapter 分離) は維持する
- **通知**: 週次ダイジェスト (企画書 Phase 1.5) を優先度を上げて計画する。RSS は一般ユーザーが使わないため主手段にしない
- **通知のための登録**: パスワードやメールアドレスの直接入力はさせず、Google などの OAuth で登録する。閲覧・検索・フォローはアカウント無しのまま (企画書 §16)。ログインした利用者はフォローをサーバー側に同期し、通知の宛先にする
  - 影響: Follow をサーバーにも持つ経路が必要 (匿名時はブラウザ内、ログイン時は D1 に同期)。メール送信基盤 (外部プロバイダ) の選定と登録が必要 → ユーザー作業
- **Phase 2 のストア順は再考**: 対象がアニメ声優なので、ポケットドラマ CD (声優タグあり) が Audible より客層の重なりが大きい可能性 (推測)。交差した声優名でポケドラの声優タグを当てるスパイクで判断する
- **Audible の並び順**: 既定は人気順のため `sort=pubdate-desc-rank` を付けて取得する (§3)。修正後は全声優の再取り込みが必要

## 12. 製品の性質の再定義 (2026-09-18 決定)

前提: アニメ本業の声優の音声作品は年に数本。実データ (35 人、直近 90 日) は DLsite 17 件 / Audible 4 件 = 週 1.6 件。

- **製品は「頻繫に見に来るフィード」ではなく「めったに鳴らないが、鳴ったら確実に届く通知」**
- **声優ページの主内容は back catalog (全期間の音声作品)**。その上に「新着があれば知らせる」層を載せる。企画書 §5 の「直近 90 日」は MVP の技術的な制限であり、取れるなら全期間取る
- **通知は「出たときだけ」**。フォロー中の声優に新作が出た週だけ 1 通。空の週は送らない
- **Kill criteria の「フィードが薄い」は基準から外す**。代わりに 声優ページ → フォロー (通知登録) の転換率、通知 → ストア送客のクリック率 を見る。`feed views` は指標から外す
- **利用者の問いの言い換え**: 「この声優の声が聴ける商品は何があるか。新しく出たら教えて」。ASMR / 朗読 / ドラマ CD の媒体区別は二次的な絞り込み (差別化の言い方として「ストア横断」より「媒体横断」が近い。継続検討)
- **取得範囲の課題**: DLsite の声優検索は robots の制約で 1 ページ目 (30 件) のみ。全期間を取る手段は (a) sitemap からの全件発見 + `product.json` (全年齢音声の総数次第で数日規模のバックフィル)、(b) 並び順違い (新しい順 / 古い順 / DL 数順) の 1 ページ目の和集合、(c) `per_page` の別値の再確認。Audible も同様に `sort` 違いの和集合 (総件数は取れるので網羅率を測れる)。§9 の発見スパイクの結果を見て決める
- **GO / NO-GO で見る厚み**: 「音声作品が 1 本以上ある対象声優の人数」と「1 人あたりの作品総数」を主指標に、直近 90 日の新作数は通知頻度の参考値にする
