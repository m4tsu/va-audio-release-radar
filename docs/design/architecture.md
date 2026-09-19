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

直近 12 シーズン (2024 WINTER 〜 2026 FALL) のアニメから、キャラクターの日本語 voiceActors を
集める。人が名前を挙げるのではなく、AniList から機械的に決める。

**人数は測定値で、AniList 側の登録が変われば動く。** 2026-09-18 の実測で
1,176 作品から **2,569 人** だった ([`../research/discovery-spike-2026-09-18.md`](../research/discovery-spike-2026-09-18.md))。
翌日の再生成では 2,567 人になっている。**現在の実数は `crawler/actors.generated.json` の
行数が正**で、この設計書の数字は規模感を示すためのものにすぎない。
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
`crawler/run.ts` の既定はこちらで、本番の全対象声優は `--actors crawler/actors.generated.json` で指定する。

### 作品 0 件の声優はページを作らない

対象声優の大半は音声作品を出していない。クロール履歴を残すため DB には全員入れるが、
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
├── adapters/            # dlsite.ts, audible.ts, pokedora.ts (ストアごとに分離。SourceAdapter を実装)
│                        # coverage.ts (網羅率), raw-work.ts (zod 検証)
├── discovery/           # 対象声優の発見と生成 (anilist / dlsite-sitemap / intersect /
│                        # actor-entity / build-actors / pokedora-tags / pokedora-intersect /
│                        # pokedora-directory: タグ辞書を引く形に直す。クロール時に使う)
├── fixtures/            # 実 HTML / JSON を切り詰めた固定データ (パーサーのテスト用)
├── lib/                 # fetch ラッパー (レート制限・スナップショット保存)、ingest クライアント
├── actors.json          # 手書きの暫定シード 35 人 (run.ts の既定)
├── actors.generated.json # AniList 由来の対象声優 (build-actors.ts の出力)
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
export type StoreSlug = "dlsite" | "audible" | "pokedora";  // Phase 2 で "audiobookjp"
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

> **ストアごとの制約は [`docs/stores/`](../stores/) にある。**
> robots.txt の該当行の引用、使ってよい / いけない URL の形、セレクタ、既知の落とし穴、
> 未確認の項目はそちらが正。**`crawler/` を触る前に該当ファイルを読むこと。**
> 本節は設計としての取得方針を書く。取得方法を変えるときは `docs/stores/` に引用を残す。

外部サイトへの fetch は `crawler/lib/fetch.ts` の 1 箇所だけを通す。
UA (ブラウザ相当)、ホストごとのレート制限、スナップショット保存、タイムアウト、
リトライ (429 は `Retry-After` を尊重) をここに集約する。

**ホストごとの間隔・タイムアウト・リトライ回数の値は `crawler/lib/fetch.ts` が持ち、
この設計書には書かない。** なぜその間隔なのかは
[`docs/stores/`](../stores/) の該当ファイル §2 にある。

### 取得の基本方針: 声優起点。ストアの全件取得はしない

対象声優を「AniList にアニメ出演がある人」(§2) と定義した時点で、ストア側から声優を発見する必要はない。
声優名で引けばよい。DLsite で比べると、声優起点は sitemap 全件より **27 倍速い**。
所要時間の内訳は間隔から導かれる値なので [`docs/stores/dlsite.md`](../stores/dlsite.md) §2 に置いてある。

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
https://www.audible.co.jp/search?searchNarrator={名前}          ← 1 ページ目
https://www.audible.co.jp/search?searchNarrator={名前}&page=2   ← 2 ページ目以降
```

**`sort=` は使わない。robots.txt が禁じている** (2026-09-19 に取得して確認):

```
#Block alternative sort order for /search
Disallow: /search*sort=pubdate
Disallow: /search*sort=title
Disallow: /search*sort=runtime
Disallow: /search*sort=review-rank

#Block searchAuthor/Narrator/Provider &sort=
Disallow: /search?searchAuthor=*&sort=
Disallow: /search?searchNarrator=*&sort=
Disallow: /search?searchProvider=*&sort=
```

最後のグループは **`sort` の値を問わず**、`searchNarrator` と `sort` の組み合わせそのものを禁じている。
`#Block alternative sort order for /search` というコメントで意図も明示されている。
パラメータの順序を入れ替えれば字面の一致は外せるが、それは規約の回避であって遵守ではない。
`User-agent` グループは `*` の 1 つだけで `Crawl-delay` の指定は無い。
間隔とその根拠は [`docs/stores/audible.md`](../stores/audible.md) §2。

**代わりにページングを使う。ページングは許可されている。** `page=` を禁じる規則はどれも
別のパラメータとの組み合わせを条件にしていて、`searchNarrator` + `page` だけの形に一致するものが無い:

| robots.txt の行 | 一致に必要なもの | 我々の URL |
|---|---|---|
| `Disallow: /search*title=*page=` | `title=` | 無い |
| `Disallow: /search*keywords=*page=` | `keywords=` | 無い |
| `Disallow: /search*node=*searchNarrator=*page=` | `node=` | 無い |
| `Disallow: /search?advsearchKeywords=*page=` | `advsearchKeywords=` | 無い |
| `Disallow: /*&sort*&page=` | `sort` | 無い |
| `Disallow: /search*searchNarrator=*=*=*=` | `searchNarrator=` の後に `=` が 3 つ | `page=` の 1 つだけ |

#### ページ番号は 1 始まり (実測)

`/newreleases` の robots.txt には `&page=0` と `&page=2` の `Allow` があり `page=1` が抜けているため、
0 始まりの可能性があった。**推測せず、斉藤壮馬 (総件数 164) で実際に引いて確かめた** (2026-09-19):

| URL | 検索結果サマリ | 件数 |
|---|---|---:|
| `?searchNarrator=斉藤 壮馬` | 検索結果 164 のうち **1 - 20** 件 | 20 |
| `&page=1` | 検索結果 164 のうち **1 - 20** 件 (`page` 無しと ASIN が完全一致) | 20 |
| `&page=2` | 検索結果 164 のうち **21 - 40** 件 | 20 |
| `&page=9` | 検索結果 164 のうち **161 - 164** 件 | 4 |

`page=N` は `20 * (N - 1) + 1` 件目から。0 始まりなら `page=2` が 41 件目からになるはずで、そうならなかった。
`page` 省略時は `page=1` と同じなので、**1 ページ目は `page` を付けない素の URL で引く**。

#### ページングで網羅率を上げる (T25。T22 の並び順のはしごを置き換えた)

**1 ページ 20 件の制約は外せない**ので、`&page=2`、`&page=3` … と順に引いて ASIN の和集合を取る。

引くのをやめる条件は 4 つ。

1. 和集合が総件数に達した … もう取るものが無い
2. 直前のページが 20 件に満たなかった … そこが最終ページなので続きが無い
3. 10 ページ (200 件) に達した … 上限
4. 取得に失敗した … 相手が答えられない状態で残りを投げ続けない。そこまでの結果で続行する

条件 2 は総件数の表示に頼らず「実際に返ってきた件数」だけで言えるので、総件数が読めなくても効く。
総件数が 1 ページに収まるときは 2 ページ目を引かない (実測 500 人中 380 人がここ)。

上限を 10 ページに置くのは、`searchNarrator=` が姓だけでも一致して総件数 355 のような値が返ることが
あるため (次の「一致率」の節)。そこで 18 ページ引いても取れるのは同姓の別人の作品で、往復が無駄になる。
上限に当たった声優は `{総件数} 件中 {取得数} 件まで取得 (1 声優あたり 10 ページが上限)` を警告に積み、
管理画面で拾う。

**ページ間で ASIN は重複しない** (斉藤壮馬の 9 ページ 164 件で重複 0 を実測)。
重複が出たとすれば取得中に並びが動いた合図で、ずれた分だけ取りこぼしている可能性がある。
黙って畳むと気づけないので `{N} ページ目に既出の作品が {M} 件 (取得中に並びが動いた可能性)` を警告に積む。

**実測 (2026-09-19)**

| 声優 | 総件数 | ページ数 | 取得 | 網羅率 |
|---|---:|---:|---:|---:|
| 斉藤壮馬 | 164 | 9 | 164 | **100%** |
| 上田麗奈 | 7 | 1 | 7 | **100%** |

並び順のはしご (6 リクエスト) では斉藤壮馬が 83/164 (50.6%)、10 種すべてでも 84/164 だった。
`sort=` を捨ててページングに替えたことで、robots.txt に従いながら網羅率が上がった。

#### 一致率 — 総件数を分母にしてよいかの判定 (T22-D)

**`searchNarrator=` は完全一致ではない。** 「佐藤 元」で引くと総件数 355 件が返るが、
1 ページ目 20 件のナレーターは佐藤恵・佐藤詩乃・佐藤弘樹・佐藤佑暉・佐藤慧・佐藤正宏で、
**佐藤元は 1 件も含まれない** (2026-09-19 実測)。姓だけ一致しても拾う。
この 355 は「佐藤姓のナレーター作品の総数」であって、その声優の作品数ではない。

そこで取得した作品のうち**本人がクレジットされている件数**を数え、`Coverage.matched` に載せる。

- 照合は `creditedNames` だけで行い、タイトルは見ない。「斉藤壮馬の本心」のように本人名が
  タイトルに入る番組があり、そこまで数えると「本人の作品が並んでいる」ことの根拠として弱くなる
- 照合相手は `canonicalName` と `searchNames` の両方。検索は「斉藤 壮馬」で通っても
  作品側が「齊藤壮馬」ということがあるので、`normalizeName` (異体字と空白を畳む) を通して比べる
- 一致率が 0.2 未満なら「検索語が広すぎる」とみなし、**`total` と `complete` を落として網羅率を不明にする**。
  `complete: false` (取りこぼしあり) にはしない。それは「取り逃した作品がある」という別の主張であり、
  佐藤元の 355 件に対して取り逃しているのは佐藤元の作品ではなく同姓の別人の作品だから。
  分母が分からない以上、言えるのは「判断できない」だけ
- 警告は `検索語が広すぎる可能性 (本人名義 M/N 件)。総件数 T は同姓の別人を含むとみて網羅率は不明とする`

しきい値を 0.2 に置けるのは、実測で 0 に近い側と 1 に近い側がはっきり分かれるため
(佐藤元 0/20、斉藤壮馬 163/164)。`matched` は `crawl_runs` には保存せず、警告としてだけ残す。

**緩い一致による保存量の増加は小さい。** Audible の作品 1,764 件のうち、追跡対象の声優が
1 人もクレジットされていないものは 87 件 (4.9%)。その多くは佐藤元の検索由来ではなく、
童話シリーズなど追跡対象外のナレーターの作品で、23 件はナレーター欄自体が無い。
佐藤元の検索が連れてきた佐藤恵の作品 10 件は、**佐藤恵自身が追跡対象**なので無駄になっていない。
`feedForActors` はクレジット経由でしか作品を出さないので、表示面への実害も無い。

#### 総件数の読み取り

総件数サマリの表記は 2 通りある (実測)。

- 2 件以上 … 「検索結果 164  のうち 1 - 20 件」
- ちょうど 1 件 … 「検索結果 1 件」。`のうち` が出ない

`のうち` だけを見ていたため、500 人のクロールで総件数を読めなかった 73 件は**すべて取得 1 件**だった。
両方の表記を読む。それでも読めないときは、**最後に引いたページが 20 件に満たなければそこが最終ページ**なので
「見えた分が全件」と判断する。上限ページまでどれも 20 件ちょうどで総件数も読めないときだけ「不明」として残す。
この判定は検証落ちを引く前の件数で行う (捨てた分を引くと「20 件未満だから最終ページ」と誤るため)。

- `/no-search-results?keywords=null` への 302 は **「ナレーター検索に該当なし」の意味**で、頻度制限ではない。
  adapter は `status: "empty"` (成功・0 件) として返し、`crawl_runs.work_count = 0` で記録する。
  既存の listing / credit は消さないので、取り違えても被害は出ない。前回 > 0 から 0 への急減は管理画面の警告で拾う
- `Accept-Language: ja-JP` を送る
- ナレーター表記は作品ごとに「上田 麗奈」「上田麗奈」と揺れる。表記のまま `creditedNames` に入れ、名寄せで吸収する
- **`searchNarrator=` 自体も空白の有無で結果が変わる**。「石見舞菜香」は該当なしだが「石見 舞菜香」だと 2 件。
  検証済みの空白入り別名を先に試し、無ければ canonicalName で検索する (§2 の別名候補)
- **`searchNarrator=` は完全一致ではない**。詳細は次の「一致率」の節
- 本文側の `li` にだけ `narratorLabel` / `authorLabel` / `runtimeLabel` / `releaseDateLabel` クラスが付く。
  同じ `li` の中の flyout (popover) は「、その他」で省略されるので、**必ず本文側を使う**
- ポッドキャストが混ざり、配信日・再生時間が無い。除外せず `releaseDate` なしで保存する
- 一覧 HTML: `li.productListItem[id="product-list-item-{ASIN}"]`、タイトルリンクは `h3 a` / `a[href^="/pd/"]`、
  表紙は `img.bc-image-inset-border[src]`
- 正規の商品 URL: `https://www.audible.co.jp/pd/{ASIN}`
- Audible は年齢区分を公開していないので `ageRating` は `unknown`、`storeCategory` は `audiobook` 固定

#### 日次の新着取得に使える URL (`/newreleases` / `/coming-soon`)

声優 1 人ずつ引く方式から「ストアの新着一覧を取ってクレジットを照合する」方式へ移す土台
(調査の全文は `docs/research/new-release-feeds-2026-09-19.md`)。**まだ実装していない。**

robots.txt は `/newreleases` を一度 `Disallow` したうえで、**許可する URL を 1 本ずつ
`$` 付きで列挙している** (`Allow` は 52 行)。`$` は終端一致なので、
**パラメータの順序も末尾も 1 文字違えば禁止側に落ちる**。
実装では許可された文字列を**そのまま定数で持ち、URL を組み立て直してはいけない**。

```
Disallow: /newreleases
Allow: /newreleases$
Allow: /newreleases?submitted=1$
```

残り 49 行は次の 1 本を土台に、パラメータを 1 種類だけ足した形になっている
(`F` = `feature_six_browse-bin=8199814051&feature_twelve_browse-bin=8199774051`。
robots のコメントによれば前者が言語、後者がフォーマットのフィルタ)。

| 足すもの | 形 | 使える値 | 本数 |
|---|---|---|---:|
| 並び順 | `/newreleases?{F}&sort={値}&submitted=1$` | `pubdate-desc-rank` `pubdate-asc-rank` `price-asc-rank` `price-desc-rank` `review-rank` `runtime-asc-rank` `runtime-desc-rank` `title-asc-rank` `title-desc-rank` (`popularity-rank` は無い) | 9 |
| ページ | `/newreleases?{F}&submitted=1&page={値}$` | **`0` と `2` だけ**。`1` も `3` 以降も列挙に無い | 2 |
| カテゴリ | `/newreleases?{F}&node={値}&submitted=1$` | 8191646051 / 8191647051 / 8191648051 / 8191649051 / 8191651051 / 8191652051 / 8191654051 / 8191655051 / 8191658051 / 8191659051 / 8191661051 / 8191662051 / 8191665051 / 8191666051 | 14 |
| 配信日 | `/newreleases?{F}&publication_date={範囲}&submitted=1$` | `20251106-20251204` / `20251113-20251204` / `20251120-20251127` / `20251120-20251204` のみ。**任意の日付範囲は指定できない** | 4 |
| 言語 (2 個目) | `/newreleases?feature_six_browse-bin=8199814051&feature_six_browse-bin={値}&feature_twelve_browse-bin=8199774051&submitted=1$` | 8199792051 / 8199799051 / 8199801051 / 8199804051 / 8199805051 / 8199813051 / 8199827051 / 8199828051 / 8199831051 / 8199836051 / 8199837051 | 11 |
| `feature_seven` | `/newreleases?feature_seven_browse-bin={値}&{F}&submitted=1$` (この順) | 8199768051 / 8199769051 / 8199770051 / 8199771051 / 8199773051 | 5 |
| `feature_nine` | `/newreleases?feature_nine_browse-bin={値}&{F}&submitted=1$` (この順) | 8199743051 / 8199744051 | 2 |
| フォーマット (2 個目) | `/newreleases?feature_six_browse-bin=8199814051&feature_twelve_browse-bin=8199774051&feature_twelve_browse-bin=8213296051&submitted=1$` | 固定 1 本 | 1 |
| 単独フィルタ | `/newreleases?feature_six_browse-bin=8199814051&submitted=1$` と `/newreleases?feature_twelve_browse-bin=8199774051&submitted=1$` | 固定 2 本 | 2 |

**`sort` と `page` の併用はできない。** `Disallow: /*&sort*&page=` に一致する。
グローバルな `Disallow: /*feature_six_browse-bin` もあるが、上の `Allow` のほうがパターンとして
長いため最長一致で許可が勝つ。

予約・配信予定は `/coming-soon` で、こちらは**ページ送りが無制限に許可されている**
(`$` が付いていない):

```
Disallow: /coming-soon
Allow: /coming-soon$
Allow: /coming-soon?page=
```

実測の中身 (2026-09-19、§2.3〜§2.7): `/newreleases` は 1 ページ 20 件・新着枠 105 件・
配信日は 5 日ぶん (1 日あたり約 21 件)。一覧に配信日とナレーター名が載るので、
既存の `parseSearchHtml` / `parseTotalCount` / `toIsoDate` がそのまま通り、照合に作品ページは要らない。
ただし **80 件中 14 件 (18%) はナレーター欄が空**で、その分は照合できない。

### ポケットドラマ CD (実装済み。T23)

運営は株式会社アニメイト。robots.txt は `Disallow: /cart/*` と `/mypage/*` のみで、
商品一覧・商品詳細・タグはすべて許可。`Crawl-delay` の指定は無い。

**声優タグ起点で取る。全件取得はしない。** 商品 sitemap を全件辿る形は禁止ではないが、
URL 数が多すぎて間隔に見合わない ([`docs/stores/pokedora.md`](../stores/pokedora.md) §4)。

取得は 4 段階で行う。

1. 声優タグ辞書の構築。`sitemap_tags_1.xml.gz` の `tag_type=1` について、
   各タグページの `<title>` (`声優【小林千晃】の…` の形) から名前を取る (一度きり。実施済み)
2. 対象声優との交差を測る。副産物としてポケドラに居る声優の全リストが手に入る
3. 交差した声優のタグページを引く (`/tags/?tag_type=1&tag_id={id}&disp_number=100&store={men\|bl}&pageno={n}`)
4. 出てきた作品の詳細を引く (全クレジット取得のため必須)

**件数と所要時間の見積もりは [`docs/stores/pokedora.md`](../stores/pokedora.md)
の「全件クロールのコスト」が正。** 間隔から導かれる値なのでここには写さない。

同じタグページに 4 ストアぶんの件数内訳が出る (`li.category_tab_el-{men|bl|adt|adt-bl}`) ので、
段階 3 の対象を辞書だけで絞り込める。件数が 0 の区分はページを引かない。

段階 4 は**走行中に取り終えた作品を既知集合へ足す**仕組み (`crawler/run.ts` の `markFetched`) で
延べ件数ではなくユニーク件数になる。1 作品に十数名が出る BL ドラマ CD では、これが無いと
同じ詳細ページを出演者の人数ぶん引き直す。credit は作品に紐づいて既に保存されており、
2 人目以降で詳細を飛ばしても出演者は落ちない。

**辞書に無い声優はポケドラを引かない**。名前から tag_id を引く API が無く (`/sapi/json.php` は 404)、
総当たりで探す手段もないため。`crawler/run.ts` がその声優のストアごと飛ばす
(集計表では 0 件ではなく `-` になる)。辞書の突き合わせは `normalizeName` なので、
人名の異体字は変換表 ([`decisions.md`](decisions.md) §16) で吸収される。
**オトナ向け 2 ストア (`adt` / `adt-bl`) は取得しない**。年齢認証の背後にあり、
AniList 対象声優との一致が 0 名で実利がない (§10)。これを外せば Cookie もセッション維持も要らない。

取得仕様 (実 HTML 6 件で確定し、上位 5 人のクロールで取った 492 作品で裏を取った):

- **出演声優の全員が取れるのは「作品情報」欄だけ**: `div.item_detail_extra` のうちヘッダが「出演声優」のものの
  `a[href*="tag_type=1"]`。href から声優の `tag_id` も取れる (DB には入れていない。下の節)。
  タイトル末尾の `【出演声優：…】` と `.item_detail_info_desc_content` は主要キャストのみ (上部 6 名に対し作品情報欄は 17 名の実例あり)
- **役名は取らない**。`役名(CV:声優名)` / `役名 CV:声優名` / `役名:声優名` / 記載なし と 4 パターン以上あり、
  単一の正規表現では抽出できない
- **発売日は存在しない**。6 件すべてで「発売日」「配信日」「リリース」が 0 件。`<meta>` は `author` と `og:*` のみ、
  JSON-LD は BreadcrumbList だけで日付フィールドが無い。sitemap の `lastmod` はページ更新日なので代理にできない。
  §7 の「発売日が無い作品は初回発見日で新着判定する」機構にそのまま乗るが、
  **1 ストアだけ日付の意味が違う**ことを UI とドキュメントで明示する
- 価格は税込のみ (`span.product_price`)。税抜は表示されない。無料の作品は 0 で出る
- ストア区分は `select[name=store] option[selected]` の value を主、JSON-LD の BreadcrumbList を予備にする。
  **2 つは語彙がずれている**: パンくずは一般を `store=home` と書き、`select` は `men` と書く。
  パンくず側を使うときは `home` を `men` に読み替える。`storeSection` に入るのは `men` / `bl`
- **シリーズ (`tag_type=2`) は捨てている**。`RawWork` に置く場所が無く、`genres` に混ぜると
  ジャンルでない語がジャンル欄に入るため。レーベル (`tag_type=3`) は `makerName`、
  関連ワード (`tag_type=4`) と商品カテゴリは `genres` に入れる
- **作品の区分は商品カテゴリ (`span.product_catgory_el` の先頭) だけで決める** (`src/domain/category.ts`)。
  実データ 492 件の内訳は BLCD 351 / 一般ドラマCD 76 / シチュエーションCD 35 / 音楽 17 /
  女性向けドラマCD 11 / 配信限定シチュエーション 2。ドラマ CD 系は `audio_drama`、
  シチュエーション系は `situation_voice`、音楽 (キャラクターソング CD) は `other`、既定は `audio_drama`。
  関連ワードを見ないのは「あまあま」「学園」のような内容の語だから。ASMR の語を含む 3 件も
  シチュエーション系のカテゴリに置かれており、カテゴリだけで正しく決まる
- カバー画像は `og:image` または `get_image.php?product_id={id}&thumb=large`
- **1 作品に複数商品 (通常版・特典版・ダウンロード版) がある**。当面は別作品として扱う (確信が無ければマージしない)
- 声優の紐付けは既存の `resolveCredit` を通す。ポケドラの `tag_id` は「同じ tag_id なら同一人物」という
  **ストア由来の事実**だが、**DB には入れていない**。理由は下の節

#### tag_id を DB に入れていない理由

492 作品から 638 個の tag_id を 3,097 回観測して、**2 つ以上の表記を持つ tag_id は 0 件**だった。
ポケドラはリンク文字列がタグ名そのものなので 1 タグ 1 表記で、tag_id から今取れる
別名義の根拠はゼロである。価値は「将来ストアをまたいで人を突き合わせるときの結合キー」だけになる。

置き場所としては次のどれも合わない。

- `voice_actor_aliases` は名前の表で、`resolveCredit` がその列を名寄せの索引として舐める。
  tag_id は名前ではないので、入れると非名前の文字列が索引と管理画面の別名一覧に混ざる
- `voice_actors` の列も合わない。1 人が複数の tag_id を持ちえて (同名別タグが 7 組)、
  ストアが増えるたびに列が増える

**将来やるなら `(store_slug, external_id)` が一意な別テーブル**にする。その一意制約が
「同じ tag_id なら同一人物」をそのまま表す。ただし tag_id をクローラーから DB へ運ぶには
`RawWork` か `IngestPayload` に項目が要り、`INGEST_PROTOCOL_VERSION` の扱い (§6) が絡む。

当面は観測した (tag_id, 表記) を `crawler/.cache/discovery/pokedora-actor-refs.json` に貯めている。
同じ tag_id に別の表記が現れたらそこに 2 つ並ぶので、DB へ移す判断の材料になる。

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
  maniax の検索結果は home と完全に同一だった。ポケドラのオトナ向けも AniList 対象声優との一致が 0 名
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
