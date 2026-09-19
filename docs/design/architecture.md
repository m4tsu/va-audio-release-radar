# アーキテクチャ設計

Status: 現行の設計。実装エージェントはこの文書に従う。

この文書は **今どうなっているか** だけを書く。いつ・なぜそう決めたか、何を覆したかは
`docs/design/decisions.md` にある。企画書 `docs/development-plan.md` は最初の草案であり、
本書と食い違う場合は本書が正。

---

## 1. この製品は何か

アニメに出演している声優をフォローすると、その人の音声作品を複数ストア横断で追えるサービス。
アニメ本業の声優の音声作品は年に数本しか出ないので、**カタログ全体 (back catalog) を見せることが主**で、
新着はめったに出ない。だから「頻繁に見に来るフィード」ではなく「めったに鳴らないが、鳴ったら確実に届く通知」として作る。
利用者の問いは「この声優の声が聴ける商品は何があるか。新しく出たら教えて」であり、
ASMR / 朗読 / ドラマ CD の媒体区別は二次的な絞り込みにすぎない。

何ではないか (このどれにも寄せない):

- ASMR 推薦サイト
- 声優事典 / アニメのキャスト DB
- 価格追跡サービス
- AI 推薦サービス
- SNS

見る指標は 声優ページ → フォロー (通知登録) の転換率 と 通知 → ストア送客のクリック率。
フィードの閲覧数は指標にしない。

---

## 2. 対象声優

> **対象声優 = AniList にアニメ出演記録がある日本語声優**

直近 12 シーズン (2024 WINTER 〜 2026 FALL) のアニメ 1,176 作品から、キャラクターの日本語 voiceActors を
集めた **2,569 人**。人が名前を挙げるのではなく、AniList から機械的に決める。
DLsite にしか居ない同人 ASMR の声優はフォロー対象にしない (クレジット表記としては保存する)。

### 自動生成の規則 (`crawler/discovery/`)

`crawler/discovery/build-actors.ts` が AniList の staff 集計から `crawler/actors.generated.json` を作る。
規則そのものは純粋関数 `crawler/discovery/actor-entity.ts` に閉じ、単体テストで固定してある。
slug は URL に出て後から変えられないため。

- `canonicalName` = AniList の `nativeName` (日本語表記)。ストアとの突き合わせに使う唯一の鍵
- `slug` = AniList の `fullName` ("Reina Ueda") を姓-名の順に並べたもの → `ueda-reina`。`id` は `va_{slug}`
  - **AniList のワープロ式表記をそのまま使う**。`Akari Kitou` → `kitou-akari`、`Aoi Yuuki` → `yuuki-aoi`。
    長音を潰して `kito` / `yuki` に寄せない。「ou」「uu」が長音とは限らず (井上 = Inoue、松浦 = Matsuura)、
    潰すと別の名前を壊すため
  - 3 語以上 (「ブリドカット・セーラ・恵美」= Sarah Emi Bridcutt) は最後の語を姓、残りを名として前から並べる
  - 1 語の名義 (「ゆかな」「麦人」「KENN」) はその語をそのまま slug にする。除外すると実在の声優が丸ごと落ちるため
- **別名候補**: Audible のナレーター検索は名前によって空白の有無で結果が変わるので、
  姓を 2 文字 / 3 文字で切った空白入り候補を最大 2 個持たせる (`上田麗奈` → `上田 麗奈`, `上田麗 奈`)。
  名前が 3 文字なら 1 / 2 文字切り、2 文字なら 1 文字切り。`fullName` が 1 語の名義は姓名の境界が無いので候補を作らない
- **除外**: 同じ `nativeName` を別の staff id も持つ (`ambiguous`)、`nativeName` が無い、slug を作れない
- **slug が衝突したら生成を失敗させる**。自動で連番を振ると同名別人を取り違えるので、解決は必ず人が
  `crawler/actors-overrides.json` に書く

`crawler/actors-overrides.json` は AniList から取れない情報だけを手で持つ。
かな (`nameKana`)、**実測で結果が返ることを確かめた** 別名 (`aliases`。1 件でもあれば自動候補は使わない)、
衝突解決の `slug`。overrides に書いてあるが AniList 側に居ないキーは書き損じとして報告される。

`crawler/actors.json` (35 人) は手書きの暫定シードで、動作確認用に残してある。
`crawler/run.ts` の既定はこちらで、本番の 2,569 人は `--actors crawler/actors.generated.json` で指定する。

### 作品 0 件の声優はページを作らない

2,569 人の大半は音声作品を出していない。クロール履歴を残すため DB には全員入れるが、
音声作品が 1 件も無い声優の `/voice-actors/{slug}` は **404 を返す**。
中身の無いページを 200 で返すと、検索エンジンから見て薄いページが 2,000 枚並ぶため。
sitemap にも出さない。声優データそのものは管理用に引き続き取得できる。

---

## 3. 技術構成と依存方向

| 項目 | 選定 | 理由 |
|---|---|---|
| フロント / SSR | TanStack Start (React 19, Vite) | `/voice-actors/{slug}` を検索エンジンにインデックスさせるため SSR が要る |
| 配信 | Cloudflare Workers (`@cloudflare/vite-plugin`) | SSR とアセットを 1 つの Worker が処理する |
| DB | Cloudflare D1 (SQLite) + Drizzle ORM | ユーザー決定。PostgreSQL は使わない |
| 検証 | Zod | crawler → ingest の境界で `RawWork` / `IngestPayload` を検証する |
| クローラー | Node.js + TypeScript (型のみ剥がして直接実行)、cheerio | Worker 内では動かさない (egress ブロックとサブリクエスト上限の回避) |
| クローラーの DB 書き込み | Worker の `POST /api/admin/ingest` (Bearer トークン) に正規化済み JSON を送る | DB アクセスコードを Worker 側 1 箇所に集約する |
| スケジューラ | GitHub Actions cron (毎日 05:00 JST) | `.github/workflows/crawl.yml`。ローカル手動実行も同じスクリプト |
| フォロー状態 | ブラウザ内保存 (Zustand + Dexie)。アカウント無し | 匿名のまま使える。通知登録だけ OAuth (§9) |
| UI | Tailwind v4 + shadcn/ui (`src/app/components/ui` に同梱) | 参照プロジェクト (`~/workspase/multi-gacha-portfolio-planner`) と同じ neutral テーマ。日本語 UI のみ (i18n は入れない) |
| Lint / Test | Biome / Vitest / Playwright | |

導入しないもの: パスワード認証、Redis、キュー、AI 推薦、**R18 作品** (§10)、別名の推測マージ (§10)。

### ディレクトリ構成

```
crawler/                 # Node スクリプト。src/domain にだけ依存する (src/app, src/server は禁止)
├── adapters/            # dlsite.ts, audible.ts (ストアごとに分離。SourceAdapter を実装)
│                        # coverage.ts (網羅率), raw-work.ts (zod 検証)
├── discovery/           # 対象声優の発見と生成 (anilist / dlsite-sitemap / intersect /
│                        # actor-entity / build-actors / pokedora-tags / pokedora-intersect)
├── fixtures/            # 実 HTML / JSON を切り詰めた固定データ (パーサーのテスト用)
├── lib/                 # fetch ラッパー (レート制限・スナップショット保存)、ingest クライアント
├── actors.json          # 手書きの暫定シード 35 人 (run.ts の既定)
├── actors.generated.json # AniList 由来 2,569 人 (build-actors.ts の出力)
├── actors-overrides.json # 手で持つ情報だけ (かな・検証済み別名・slug 衝突解決)
├── cli.ts               # 調査用。`node crawler/cli.ts actor "上田麗奈"` / `diff`
└── run.ts               # 定期実行の本体。`node crawler/run.ts --base-url ...`
migrations/              # drizzle-kit が生成する SQL。wrangler d1 migrations apply で適用
src/
├── domain/              # 純粋な型・正規化・名寄せ・カテゴリ判定。React / DB / fetch に依存しない
├── server/              # Worker 側でだけ動くコード (D1 アクセス、server functions の実装)
│   ├── db/schema.ts     # Drizzle スキーマ
│   ├── db/client.ts     # env.DB から drizzle を作る
│   ├── db/chunked.ts    # IN 句の分割 (D1 の bound parameter 上限対策)
│   └── queries/         # 画面ごとの読み取り、ingest の upsert、管理画面
├── app/                 # React
│   ├── routes/          # TanStack Start のファイルベースルート (SSR)。api/ は server route
│   ├── components/      # 共通 UI (ui/ は shadcn 生成物)
│   ├── server-fns/      # createServerFn の定義 (画面から呼ぶ)
│   ├── store/           # フォロー状態 (Zustand + Dexie)
│   └── lib/
├── router.tsx           # TanStack Start が読む getRouter()
└── index.css
```

依存方向: `app → server → domain`、`crawler → domain`。逆方向は Biome の `noRestrictedImports` で禁止する。
`src/server/**` のクライアントへの混入は TanStack Start の import protection (`vite.config.ts`) で止める。
`src/server/**` は `.server.ts` の命名にせず、server functions (`createServerFn`) の handler からのみ import する。

---

## 4. ドメインモデル (`src/domain/types.ts`)

日時は ISO 8601 文字列 (UTC)。ID は文字列。

```ts
export type StoreSlug = "dlsite" | "audible";            // Phase 2 で "pokedora" | "audiobookjp"
export type WorkCategory = "asmr" | "audio_drama" | "audiobook" | "situation_voice" | "other";
export type CreditConfidence = "verified" | "probable" | "unmatched";
export type AgeRating = "general" | "r18" | "unknown";

export type VoiceActor = {
  id: string;                 // "va_ueda-reina"
  slug: string;               // "ueda-reina"
  canonicalName: string;      // "上田麗奈"
  nameKana?: string;
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
  id: string;                 // "{storeSlug}:{storeProductId}" (ストア横断マージはしない)
  title: string;
  category: WorkCategory;
  releaseDate?: string;       // "YYYY-MM-DD"
  coverImageUrl?: string;
  durationSeconds?: number;
  ageRating: AgeRating;
  makerName?: string;
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
  storeSection?: string;      // ストアが名乗っている区分をそのまま (§4「年齢区分と BL」)
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
  releaseDate?: string;
  durationSeconds?: number;
  price?: number;
  listPrice?: number;
  makerName?: string;
  creditedNames: string[];    // 声優 / ナレーターとして表記されている名前 (全員)
  storeCategory?: string;     // "SOU" / "audiobook" などストア固有の分類
  genres?: string[];
  ageRating: AgeRating;
  storeSection?: string;
  fetchedAt: string;
};

/** ingest エンドポイントの入力 */
export type IngestPayload = {
  runId: string;
  storeSlug: StoreSlug;
  voiceActorId: string;       // このクロールの対象声優
  works: RawWork[];
  error?: string;             // 取得失敗時 (works は空)
  totalCount?: number;        // ストアが出している検索結果の総件数
  coverageComplete?: boolean; // 総件数が読めなければ undefined のまま
};
```

`STORE_SLUGS` / `WORK_CATEGORIES` / `AGE_RATINGS` / `CREDIT_CONFIDENCES` の値配列を同ファイルに持ち、
型の全メンバーを過不足なく含むことをコンパイル時に検査している。DB スキーマの enum はこの配列をそのまま使う。

`rawWorkSchema` / `ingestPayloadSchema` (zod) が crawler → ingest の境界で検証する。
`productUrl` / `coverImageUrl` は **`https:` の絶対 URL に限定**する。この値は `<a href>` と `<img src>` に
そのまま出るので、`javascript:` や `data:` を通すとスクリプト実行の入口になるため。
`releaseDate` は `YYYY-MM-DD` 固定で、DB の並べ替えを文字列比較で成立させる。

### 年齢区分と BL

`AgeRating` は真偽値ではなく列挙。ストアが「全年齢 / R18」の 2 値で割っていないことと、
年齢区分を公開していないストア (Audible) を「全年齢」と言い切らないため。

**BL は `AgeRating` に入れない**。BL は年齢区分ではなく内容の区分で、ポケドラがストアを 4 つに
割っている (`men` / `bl` / `adt` / `adt-bl`) ために混ざって見えるだけ。
ストア固有の区分は解釈せず `StoreListing.storeSection` にそのまま残す。
ストアが区分を増やしても移行が要らず、BL のような年齢区分でない切り口で後から絞れる。
DLsite は `site_id` (`home` / `maniax`) がそのまま入る。

保存してよい区分は `DEFAULT_ALLOWED_AGE_RATINGS = ["general", "unknown"]`。
`unknown` を許すのは Audible が年齢区分を公開しておらず、弾くとストアごと落ちるため。
判定は `isAgeRatingAllowed(ageRating, allowed)` で、許可集合を引数にしてある。
将来 R18 を扱う判断をしたときに呼び出し側の設定だけで切り替えられるようにし、
ドメイン層に「R18 は捨てる」という決め打ちを埋め込まないため。

### 名寄せ (`src/domain/identity.ts`)

純粋関数 `resolveCredit(creditedName, actors, aliases) → { voiceActorId?, confidence }`:

1. `creditedName === canonicalName` → verified
2. `creditedName === alias.name` かつ `alias.verified` → verified
3. `normalizeName(creditedName) === normalizeName(canonicalName or alias)` → verified
   (`normalizeName`: NFKC 正規化、空白・中黒・記号の除去、全角英数→半角。かな⇄カナ変換はしない)
4. それ以外 → unmatched (`voiceActorId` 無し)。管理画面の未解決キューに出す

**LLM や類似度による推測マージはしない。**

### カテゴリ判定 (`src/domain/category.ts`)

`categorize(storeSlug, storeCategory, genres, titleRaw) → WorkCategory`。
ジャンルとタイトルの両方を見て、上から順に当てる。

1. Audible → `audiobook` (朗読以外の判定はしない)
2. DLsite の `work_type` が `SOU` 以外 (`MUS` など) / 不明 → `other`
3. ジャンルかタイトルに「ボイスドラマ」「ドラマCD」「オーディオドラマ」→ **`audio_drama`**
4. ジャンルに「ドラマ」を含む語 → **`audio_drama`** (DLsite が将来ジャンルを持った場合の受け)
5. ジャンルかタイトルに ASMR 系の語 (ASMR / 耳かき / 耳ふー / 耳舐め / ささやき / 囁き / バイノーラル /
   ダミヘ / 安眠 / 睡眠 / 添い寝 / マッサージ / 催眠音声) → **`asmr`**
6. ジャンルかタイトルに「シチュエーション」「シチュボ」→ **`situation_voice`**
7. どれにも当たらなければ **`asmr`** (DLsite 全年齢音声の大半が ASMR のため)

3 を 5 より先に見るのは、「ASMR」ジャンルが付いたボイスドラマがあるため。
逆に「【ASMRおやすみドラマ】…」のようにタイトルへ「ドラマ」だけが入る ASMR 作品もあるので、
タイトル側では複合語 (ボイスドラマ / ドラマCD) しか拾わない。
DLsite のジャンルに「ドラマ」「シチュエーション」という語は実データ 200 件で 1 件も無く、
ドラマ作品を見分けられるのはタイトルだけだった (根拠は `docs/design/decisions.md`)。

ingest 側は **ジャンル情報があるときだけカテゴリを更新する**。`--skip-known` で詳細を取らなかった作品の
分類を既定値で潰さないため。

---

## 5. DB スキーマ (`src/server/db/schema.ts`, Drizzle / SQLite)

テーブル名・列名は snake_case。日時はすべて ISO 8601 文字列 (SQLite の日付型は使わない)。
真偽値は integer の 0/1 を boolean モードで見せる。列挙はドメインの値配列をそのまま渡し、ここで再定義しない。

| テーブル | 列 |
|---|---|
| `voice_actors` | `id` PK, `slug` UNIQUE, `canonical_name`, `name_kana`, `anilist_staff_id`, `image_url`, `status` (既定 `unknown`), `created_at`, `updated_at` |
| `voice_actor_aliases` | `id` PK autoinc, `voice_actor_id` FK, `name`, `source`, `verified` (既定 false), UNIQUE(`voice_actor_id`, `name`) |
| `audio_works` | `id` PK, `title`, `category`, `release_date`, `cover_image_url`, `duration_seconds`, `age_rating` (既定 `unknown`), `maker_name`, `created_at`, `updated_at` |
| `store_listings` | `id` PK autoinc, `audio_work_id` FK, `store_slug`, `store_product_id`, `product_url`, `affiliate_url`, `title_raw`, `price`, `list_price`, `store_section`, `available`, `first_seen_at`, `last_seen_at`, `last_checked_at`, UNIQUE(`store_slug`, `store_product_id`) |
| `audio_credits` | `id` PK autoinc, `audio_work_id` FK, `voice_actor_id` FK nullable, `credited_name`, `role`, `confidence`, `source_store_slug`, UNIQUE(`audio_work_id`, `credited_name`, `source_store_slug`) |
| `crawl_runs` | `id` PK (クローラーが払い出す runId), `store_slug`, `voice_actor_id`, `started_at`, `finished_at`, `work_count`, `new_count`, `status` (`ok`/`error`), `error`, `total_count`, `coverage_complete` |

索引: `audio_works(release_date)` (新着順の一覧が主な読み取り)、`store_listings(audio_work_id)`、
`audio_credits(voice_actor_id)` (声優ページの作品一覧がこの索引だけで引ける)、
`crawl_runs(store_slug, voice_actor_id, started_at)` (前回の結果と比べて件数の急減を検知する)。

補足:

- `age_rating` の既定が `unknown` なのは、区分を読めなかった作品を「全年齢」と言い切らないため。
  読み取り側は **R18 だけを除く** 形で絞る。許可制にすると Audible の作品が丸ごと消える
- `last_checked_at` は取得したが一覧に出なかった場合も更新する。`last_seen_at` との差でクロール漏れを見分ける
- `crawl_runs.work_count` は許可した年齢区分だけの保存件数なので `total_count` と一致しないことがある。
  網羅できたかの判定には `coverage_complete` を使い、総件数が読めなければ NULL のままにする
  (知らないまま「全部取れた」と記録すると、取りこぼしを見逃す方向に嘘をつくため)
- フォローはブラウザ内 (Dexie) にしか無いのでテーブルが無い

---

## 6. データ取得

外部サイトへの fetch は `crawler/lib/fetch.ts` の 1 箇所だけを通す。
UA (ブラウザ相当)、ホストごとのレート制限、スナップショット保存、タイムアウト 30 秒、
リトライ (最大 4 回、429 は `Retry-After` を尊重) をここに集約する。

| ホスト | 間隔 | 根拠 |
|---|---:|---|
| dlsite.com | 10 秒 | robots.txt の `Crawl-delay: 10` |
| audible.co.jp | 6 秒 | `Crawl-delay` の指定なし |
| pokedora.com | 5 秒 | `Crawl-delay` の指定なし |
| graphql.anilist.co | 1.5 秒 | API のレート枠 |

### 取得の基本方針: 声優起点。ストアの全件取得はしない

対象声優を「AniList にアニメ出演がある人」(§2) と定義した時点で、ストア側から声優を発見する必要はない。
声優名で引けばよい。DLsite で比べると 声優起点 2,569 人 = 7.1 時間 に対し
sitemap 全件 68,321 作品 = 190 時間 で、**27 倍の差**がある。

### DLsite (全年齢サイト `/home/`)

検索 URL (声優名の完全一致、音声カテゴリ、新着順):

```
https://www.dlsite.com/home/fsr/=/language/jp/keyword_creater/"{名前}"/work_type_category[0]/audio/order/release_d/page/1
```

名前はダブルクォートで囲んで URL エンコードする。robots.txt が 2 ページ目以降を禁じているので
**1 ページ目に固定**する (既定 30 件)。`per_page` は指定しても無視され、既定件数しか返らない。

取得手順:

1. 新着順 (`order/release_d`) の 1 ページ目を取る
2. 埋め込み JSON の `"pager":{"count":N,"have_to_paginate":bool}` で総件数を読む。
   実取得件数が下回るときだけ古い順 (`order/release`) の 1 ページ目を足して和集合にする (最大 60 件)。
   `pager.count` と実取得件数は `crawl_runs.total_count` / `coverage_complete` に記録して網羅率を監視する
3. 一覧から ID・タイトル・サークル・価格・定価・割引率バッジ・サムネイル・種別を取る。**一覧に発売日は無い**
4. DB に無い ID だけ `https://www.dlsite.com/home/api/=/product.json?workno=RJ...` を **1 件ずつ**引く
   (カンマ区切りで複数渡すと空配列が返る)。発売日・声優全員・年齢区分・ジャンルをここで補う
5. 許可していない年齢区分 (現状は R18) の作品を捨てる

一覧 HTML の要点 (サーバー側描画済み):

- `ul#search_result_img_box > li[data-list_item_product_id="RJ..."]`
- `dd.work_name a[href]` にタイトルと商品 URL、`dd.maker_name > a` にサークル名、`span.author a` に声優名
- `dd.work_price_wrap .work_price .work_price_base` に現在価格、`span.strike .work_price_base` に定価
- `div.work_category` の class `type_SOU` が作品種別 (SOU = ボイス・ASMR)
- 表紙は `thumb-with-ng-filter-block[:thumb-candidates]` から取り、`resize/images2` → `modpub/images2`、
  `_240x240.jpg` → `.jpg` に置換すると原寸になる

`product.json` から使う項目: `workno, work_name, maker_name, maker_id, regist_date, age_category,
age_category_string, work_type, work_type_string, price, official_price, image_main.file_name,
creaters.voice_by[].name, genres[].name, on_sale, site_id`。
一覧の `span.author` は代表 1 名だけなので、**声優全員は必ず `creaters.voice_by` から取る**。
`age_category` は 1 だけが全年齢で、2 (R15) も 3 (R18) もまとめて `r18` に寄せる。
区別が要るのは「載せるか載せないか」だけなので、載せない側の内訳を持っても使い道が無い。

正規の商品 URL: `https://www.dlsite.com/home/work/=/product_id/{workno}.html`。

### Audible Japan

```
https://www.audible.co.jp/search?searchNarrator={名前}&sort=pubdate-desc-rank
```

`sort` を単独で付けると HTTP 200 のまま発売日降順になる。既定 (sort 無し) は人気順なので、
20 件を超える声優 (石田彰は 38 件) では新作が 1 ページ目に載らない。
`pageSize` や `page` を足すと `no-search-results` へ 302 され、robots.txt も `page=` との組み合わせを禁じている。
**1 ページ 20 件の制約は外せない**ので、総件数 (「検索結果 N のうち…」の表示) が 20 を超えるときだけ
`sort=pubdate-asc-rank` (古い順) の 1 ページ目を足して和集合にする (最大 40 件)。
それでも届かなければ網羅率を警告に積む。

- `/no-search-results?keywords=null` への 302 は **「ナレーター検索に該当なし」の意味**で、頻度制限ではない。
  adapter は `status: "empty"` (成功・0 件) として返し、`crawl_runs.work_count = 0` で記録する。
  既存の listing / credit は消さないので、取り違えても被害は出ない。前回 > 0 から 0 への急減は管理画面の警告で拾う
- `Accept-Language: ja-JP` を送る
- ナレーター表記は作品ごとに「上田 麗奈」「上田麗奈」と揺れる。表記のまま `creditedNames` に入れ、名寄せで吸収する
- **`searchNarrator=` 自体も空白の有無で結果が変わる**。「石見舞菜香」は該当なしだが「石見 舞菜香」だと 2 件。
  検証済みの空白入り別名を先に試し、無ければ canonicalName で検索する (§2 の別名候補)
- 本文側の `li` にだけ `narratorLabel` / `authorLabel` / `runtimeLabel` / `releaseDateLabel` クラスが付く。
  同じ `li` の中の flyout (popover) は「、その他」で省略されるので、**必ず本文側を使う**
- ポッドキャストが混ざり、配信日・再生時間が無い。除外せず `releaseDate` なしで保存する
- 一覧 HTML: `li.productListItem[id="product-list-item-{ASIN}"]`、タイトルリンクは `h3 a` / `a[href^="/pd/"]`、
  表紙は `img.bc-image-inset-border[src]`
- 正規の商品 URL: `https://www.audible.co.jp/pd/{ASIN}`
- Audible は年齢区分を公開していないので `ageRating` は `unknown`、`storeCategory` は `audiobook` 固定

### ポケットドラマ CD (次に追加するストア。未実装)

運営は株式会社アニメイト。robots.txt は `Disallow: /cart/*` と `/mypage/*` のみで、
商品一覧・商品詳細・タグはすべて許可。`Crawl-delay` の指定は無い。

**声優タグ起点で取る。全件取得はしない** (sitemap の商品 URL は 76,731 件あり、5 秒間隔で 106 時間かかる)。

| 段階 | 内容 | コスト |
|---|---|---|
| 1 | 声優タグ辞書の構築。`sitemap_tags_1.xml.gz` の `tag_type=1` 3,161 件について、各タグページの `<title>` (`声優【小林千晃】の…` の形) から名前を取る | 3,161 × 5 秒 = 4.4 時間 (一度きり) |
| 2 | AniList 2,569 人との交差を測る。副産物としてポケドラに居る声優の全リストが手に入る | 0 |
| 3 | 交差した声優のタグページを引く (`/tags/?tag_type=1&tag_id={id}&disp_number=100`、一般 + BL の 2 回) | 交差人数 × 2 × 5 秒 |
| 4 | 出てきた作品の詳細を引く (全クレジット取得のため必須) | 作品数 × 5 秒 |

同じタグページに 4 ストアぶんの件数内訳が出る (`li.category_tab_el-{men|bl|adt|adt-bl}`) ので、
段階 3 の対象を辞書だけで絞り込める。
**オトナ向け 2 ストア (`adt` / `adt-bl`) は取得しない**。年齢認証の背後にあり、
AniList 対象声優との一致が 0 名で実利がない (§10)。これを外せば Cookie もセッション維持も要らない。

取得仕様 (実 HTML 6 件で確定):

- **出演声優の全員が取れるのは「作品情報」欄だけ**: `div.item_detail_extra` のうちヘッダが「出演声優」のものの
  `a[href*="tag_type=1"]`。href の `tag_id` を声優の外部 ID として保存できる。
  タイトル末尾の `【出演声優：…】` と `.item_detail_info_desc_content` は主要キャストのみ (上部 6 名に対し作品情報欄は 17 名の実例あり)
- **役名は取らない**。`役名(CV:声優名)` / `役名 CV:声優名` / `役名:声優名` / 記載なし と 4 パターン以上あり、
  単一の正規表現では抽出できない
- **発売日は存在しない**。6 件すべてで「発売日」「配信日」「リリース」が 0 件。`<meta>` は `author` と `og:*` のみ、
  JSON-LD は BreadcrumbList だけで日付フィールドが無い。sitemap の `lastmod` はページ更新日なので代理にできない。
  §7 の「発売日が無い作品は初回発見日で新着判定する」機構にそのまま乗るが、
  **1 ストアだけ日付の意味が違う**ことを UI とドキュメントで明示する
- 価格は税込のみ (`span.product_price`)。税抜は表示されない
- ストア区分は `select[name=store] option[selected]` の value (`men` / `bl` / `adt` / `adt-bl`) と
  JSON-LD の BreadcrumbList の両方から取れ、一致することを確認済み。`storeSection` にそのまま入れる
- シリーズは `a[href*="tag_type=2"]`、レーベルは `tag_type=3`。単発作品にはシリーズ欄自体が無い
- カバー画像は `og:image` または `get_image.php?product_id={id}&thumb=large`
- **1 作品に複数商品 (通常版・特典版・ダウンロード版) がある**。当面は別作品として扱う (確信が無ければマージしない)
- 声優の紐付けは既存の `resolveCredit` を通す。ポケドラの `tag_id` は「同じ tag_id なら同一人物」という
  **ストア由来の事実**なので、別名義の根拠として使える (§10 の原則に合致)。表記揺れを吸収できる可能性がある (要確認)
- 実装時に `StoreSlug` へ `pokedora` を追加する

### AniList

`POST https://graphql.anilist.co`。認証不要。
`{ Staff(search:"上田麗奈"){ id name{ full native } } }` で staff id が引ける。
対象声優の生成 (§2) では直近 12 シーズンのアニメ → キャラクター → 日本語 voiceActors をたどる。

### audiobook.jp (保留)

robots.txt は `Disallow: /public/index.php/` のみで検索・商品ページの取得を禁じていないが、
利用規約 第15条(15) が「当社の事前の許可なく、情報解析をする行為」を禁じている。
本プロジェクトの取得がこれに当たるかは条文から判断できないため、**実装前にオトバンクへ照会する**。
文面は `docs/research/otobank-inquiry-draft.md`。照会はユーザーが行う。返信が来るまで着手しない。

### 取り込み (`POST /api/admin/ingest`)

`RawWork` → `AudioWork` + `StoreListing` を upsert (`first_seen_at` は初回のみ)、
`creditedNames` ごとに `resolveCredit` → `audio_credits` を upsert、`crawl_runs` を 1 行追加する。

- 対象声優の名前が `creditedNames` に含まれない作品も保存はするが、**その声優への credit は作らない**
  (検索結果のノイズ対策)
- 書き込みは `db.batch` にまとめる。順序は 作品 → listing → credit に固定する
  (後ろ 2 つが `audio_works` を外部キーで参照するため)。
  「今回はじめて見た listing か」は書き込む前に 1 回の `IN` クエリで判定する
- credit の名寄せ結果が unmatched のときは、既存行の `voice_actor_id` / `confidence` を**上書きしない**。
  管理画面で人が割り当てた行が再クロールのたびに剥がれるのを防ぐため
- `IN` 句に並べる値は必ず `src/server/db/chunked.ts` の `chunked()` で **90 件ずつ**に切る。
  D1 の bound parameter 上限は 100 で、超えると本番だけ実行時に落ちる (単体テストの libsql では通ってしまう)

取得に失敗しても `error` 付きで必ず送る。`crawl_runs` に失敗が残らないと管理画面から
「クローラーが壊れている」ことに気づけないため。失敗があっても全件送り切ってから終了コード 1 にする。

---

## 7. 新着とフィード

- **新着は発売日基準**。NEW バッジと「今週の新着」は `release_date` が 7 日以内 (`NEW_DAYS`)。
  並びは発売日の降順。`first_seen_at` だけで判定しない (初回クロールと声優追加のたびに全作品が新着になるため)
- **フィードは 3 段**: 今後の発売 (`upcoming`) / 30 日以内の新作 (`recent`, `RECENT_DAYS`) /
  それ以前 (`older`、折りたたみ、直近 90 日 = `FEED_WINDOW_DAYS`)。上 2 段が空でも画面が空にならない
- 段分けと NEW バッジは **サーバーが `freshness` として値で配る**。クライアントで再計算すると
  SSR とハイドレーション後で時計が違って結果がずれるため
- **今後の発売**: `release_date` が未来の作品 (DLsite の予約) は別枠で先頭に出す
- **発売日の無い作品** (Audible のポッドキャスト、ポケドラ全般) だけ、その声優の初回クロール
  (`crawl_runs` の最古の成功 run) 以降に見つかったものを新着扱いにする。初回クロールで見つかった分は新着にしない
- **利用者ごとの未読**: 最後にフィードを見た日時をブラウザ (Dexie) に保存し、
  それ以降に発売 / 発見された作品に未読の印を付ける。アカウント無しで「既読にする」を実現する

声優ページの主内容は back catalog (全期間の音声作品) で、その上に「新着があれば知らせる」層を載せる。

---

## 8. 画面

| パス | 内容 | SSR |
|---|---|---|
| `/` | 検索ボックス、全声優の最近の新着 (直近 30 日 / 24 件)、声優一覧。フォロー中の声優のフィード (90 日 / 60 件、3 段) | 有。フィード部分だけマウント後にフォロー ID を読んで server function を呼ぶ |
| `/voice-actors/$slug` | 声優名、フォローボタン、ストアごとの最新作品 (1 ストア 30 件)。作品 0 件なら 404 | 有。**インデックス対象**。JSON-LD と canonical を出す |
| `/works/$id` | タイトル、表紙、クレジット (表記違いの重複は排除)、ストア別の価格と購入リンク | 有。`$id` は `dlsite:RJ...` の形でコロンを含むため sitemap では `%3A` に符号化する |
| `/following` | フォロー中の声優一覧と解除 | 枠だけ SSR。中身はマウント後。`noindex` (ブラウザごとに違うため) |
| `/admin/unmatched-credits` | 未解決クレジットの一覧と手動割り当て | 有 |
| `/admin/crawler-health` | `crawl_runs` の直近結果、件数急減の警告、網羅率 | 有 |

画面データは server functions (`createServerFn`、`src/app/server-fns/`) で取る。JSON として外に出すのは次だけ。

| ルート | 用途 |
|---|---|
| `GET /api/health` | 稼働確認 `{ ok: true }` |
| `POST /api/admin/ingest` | クローラーからの取り込み。本文は `IngestPayload`。`{ upserted, new, unmatched }` を返す |
| `POST /api/admin/actors` | 声優シードの upsert。2,500 人規模なので分割して送る |
| `GET /api/admin/known-ids?store=dlsite` | DB にある `store_product_id` の配列。DLsite の詳細取得を新規だけに絞るために使う |
| `GET /sitemap.xml` | 声優ページと作品ページの URL。オリジンは canonical と同じ `siteOrigin()` で決める |
| `GET /robots.txt` | `/admin/` を Disallow |

管理系 3 つは `Authorization: Bearer {INGEST_TOKEN}`。

### 秘匿値と認可

- wrangler secret: `INGEST_TOKEN`, `ADMIN_TOKEN`。未設定なら該当機能は 503
- `vars` (秘匿ではない): `SITE_URL`。canonical / og:url / sitemap / robots.txt の Sitemap 行を絶対 URL にする
  オリジン。空文字なら実際に来たリクエストのオリジンを使う (`src/server/site.ts` の `siteOrigin()`)。
  `head()` は SSR とクライアントの両方で動くので、オリジンはローダーで解決して loaderData 経由で渡す
- `/admin/*?token=` は `ADMIN_TOKEN` と一致したときだけ HttpOnly cookie を立てる。一致しなければ cookie を触らず、
  トークンを落とした同じパスへ 303 で送り直す (応答の形で当たり外れを区別させない)。
  `token=` が空なら cookie を消す。トークン比較は長さが違っても定数時間で回す
- 描画側でも `src/app/lib/safe-url.ts` の `safeHttpsUrl()` で URL をもう一度絞る。
  zod の検証を足す前に DB へ入った行が残りうるため
- JSON-LD は `JSON.stringify` 後に `<` を `<` にエスケープしてから埋め込む

---

## 9. 通知

新着はめったに出ないので、通知は **「出たときだけ」**。
フォロー中の声優に新作が出た週だけ 1 通のダイジェストを送り、空の週は送らない。
RSS は一般ユーザーが使わないので主手段にしない。

登録方法はパスワードやメールアドレスの直接入力をさせず、**Google などの OAuth** で行う。
閲覧・検索・フォローはアカウント無しのまま使える。
ログインした利用者はフォローをサーバー側 (D1) に同期し、通知の宛先にする。
匿名時はブラウザ内、ログイン時は D1 という二重の経路が要る。
メール送信基盤 (外部プロバイダ) の選定と登録はユーザー作業。

---

## 10. 年齢区分

**対象は全年齢 + BL (全年齢 BL)。R18 は載せない。**

R18 を載せない理由は 2 つだけで、どちらも実測に基づく。

- **実利がゼロ**。DLsite maniax (R18) を代表 10 名で調べたところ、R18 側だけに存在する作品は 0 件。
  maniax の検索結果は home と完全に同一だった。ポケドラのオトナ向けも AniList 2,569 人との一致が 0 名
- **Amazon アソシエイトのリスク**。「露骨な性的描写がある場合」は参加申請をお断りするサイト例に明記されている。
  R18 を載せると Audible の送客経路を失う可能性がある

一方 **BL を含めることは重要**で、外すと男性声優の対象作品を大きく失う。
BL ドラマ CD はアニメ声優が本名義で出演するのが普通で、斉藤壮馬はポケドラ 143 件中 98 件が BL。
全年齢 BL は年齢確認も Cookie も不要で、声優は本名義でタグ付きになっている。

### 別名義の原則

**別名義は「信頼できる情報に基づく場合に限り」紐付ける。** 成人向けかどうかとは独立した原則。

- 根拠として認めるもの: 本人・事務所が公表している情報、ストア自身が同一人物として扱っている事実、
  出典のある公開情報
- 認めないもの: 声質・作風・活動時期などからの推測、LLM による判断、「たぶん同じ人」という運用者の心証
- 実装は `VoiceActorAlias` の `verified` / `source` で表現する。`verified: true` は根拠を確認したものだけに付ける
- 間違えたときの被害 (実在の人物に、公表していない出演作を結び付ける) が大きいため、迷ったら紐付けない

**DLsite からは別名義の根拠が得られない**ことを実測で確認した。スナップショット 2,275 件で
`creaters` の id と name は完全な 1 対 1 で、同じ id に複数名義の例は 0 件。
1 つの id が複数の役割 (voice_by と music_by) にまたがる例は 138 件あり id が人単位の識別子であることは確かだが、
**名義はまたがない**。声優個人のプロフィールページも存在しない (プロフィールがあるのはサークルのみ)。

将来 R18 を扱う判断をする場合、年齢確認の導線、アフィリエイト規約の確認 (DLsite / Amazon アソシエイト)、
ホスティング規約の確認が別途必要になる。現時点では Cloudflare は合法な成人向けを禁止カテゴリに挙げておらず、
DLsite アフィリエイトにも成人向けを禁ずる条項は無い。

---

## 11. 差別化の柱

**出演形態を軸に置く。** 単独 / 少人数 / 全編朗読 / 大人数 の区別を作品に持たせる。

- 実装コストがほぼゼロ。DLsite の `voice_by` 配列長と Audible のナレーター配列長で判定できる
- 実データでも分かれる。DLsite は 61% が単独、8% が 2 人
- 価値は Audible 側で特に高い。全編朗読か 20 人中 1 人かで購買判断が変わる
- 来訪頻度に依存せず、back catalog 中心の設計とかみ合う (§1)

採らなかった案:

- **共演バッジ (推し 2 人出演) は低優先**。AniList 声優が 2 人以上の作品は 75 件中 16 件 (21%) あるが、
  中身は「同じ企画への複数出演」で、有名声優同士の偶然の共演ではない。
  クレジットは全員分保存済みなので、集合積だけでいつでも実装できる。データ基盤の追加対応は不要
- **商業イベント (セール / 予約 / 無料) はスキップ**。セール中が 41% で常態、予約作品は全年齢音声で 0 件、
  無料は 0.6%。セールは通知ではなく声優ページのフィルタとして持つ。
  「新規にセールになった」の検出自体は `price` / `list_price` の前回値比較で可能だが、
  back catalog を毎日引く必要がありコストが見合わない。後から始めても失うデータはない

判断規則: 「この機能はフォロー情報があるから成立するか」。成立しないなら他社でもできることなので作らない。

---

## 12. コーディング規約

- TypeScript strict、`noUncheckedIndexedAccess`、`erasableSyntaxOnly`。コメントは日本語で「なぜ」を書く
- Biome (`npm run lint`)。ダブルクォート、セミコロン、100 桁
- テスト: domain と crawler は node 環境の Vitest。adapter のパーサーは `crawler/fixtures/` の
  固定 HTML / JSON に対してテストする。**ネットワークに出るテストは書かない**
- 外部サイトへの fetch は `crawler/lib/fetch.ts` の 1 箇所を通す
- 完了条件は常に `npm run check` (型・lint・単体テスト) と `npm run build` の通過

---

## 付録: 旧節番号との対応

コード中のコメントには、この文書を書き直す前の節番号 (`設計書 §13` など) が残っている。
対応は次のとおり。コメントを読むときはこの表で読み替える。

| 旧 | 旧の見出し | 新 |
|---|---|---|
| §1 | 決定事項 | §3 技術構成と依存方向 |
| §2 | ディレクトリ構成と依存方向 | §3 |
| §3 | データ取得の調査結果 | §6 データ取得 |
| §4 | ドメインモデル / 名寄せ / カテゴリ判定 | §4 ドメインモデル |
| §5 | DB スキーマ | §5 DB スキーマ |
| §6 | HTTP / server functions | §8 画面 (API と秘匿値の項) |
| §7 | 画面 | §8 画面 |
| §8 | コーディング規約 | §12 コーディング規約 |
| §9 | 対象声優の定義 | §2 対象声優 |
| §10 | 「新着」の定義とフィードの構成 | §7 新着とフィード |
| §11 | 差別化の軸と通知の方針 | §9 通知 / §11 差別化の柱 |
| §12 | 製品の性質の再定義 | §1 この製品は何か / §7 |
| §13 | 差別化の柱と取得方針 | §11 差別化の柱 / §6 データ取得 |
| §14 | 企画書の位置づけと年齢区分の方針 | §10 年齢区分 (企画書の位置づけは `decisions.md`) |
| §15 | ポケットドラマ CD の取得方針 | §6 データ取得 (ポケットドラマ CD) |
