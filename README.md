# Koenect

アニメに出演している声優をフォローすると、その人の音声作品を複数ストア横断
(DLsite / Audible / ポケットドラマ CD) で追える Web サービス。

何を作るかは [`docs/product.md`](./docs/product.md)、システムの境界は
[`docs/architecture.md`](./docs/architecture.md)。文書の入口は [`docs/README.md`](./docs/README.md)。

## 技術構成

| 領域 | 選定 |
|---|---|
| 言語 / ビルド | TypeScript strict, Vite, React 19 |
| フロント / SSR | TanStack Start (ファイルベースルート: `src/app/routes`) |
| UI | Tailwind v4, shadcn/ui (`src/app/components/ui` にコード同梱) |
| DB | Cloudflare D1 (SQLite) + Drizzle ORM (`src/server/db`) |
| 検証 | Zod |
| テスト | Vitest + Testing Library (`node` / `app` の 2 プロジェクト)、Playwright (E2E: `e2e/`) |
| Lint / Format | Biome |
| 配信 | Cloudflare Workers (`@cloudflare/vite-plugin`) |
| クローラー | Node.js 24 + cheerio (`crawler/`。Worker 内では動かさない) |

## ローカル開発

```bash
npm install
npm run db:migrate:local   # ローカル D1 にスキーマを作る
npm run dev                # ポートは vite.config.ts の server.port
```

手元の D1 の位置づけと作り直し方は「本番 D1」。

秘匿値が要る機能 (取り込み・管理画面・お問い合わせ) を触るときは `.dev.vars.example` を `.dev.vars` にコピーして値を入れる。
canonical / og:url / `sitemap.xml` を本番の正規ホストに固定する場合は `wrangler.jsonc` の `vars.SITE_URL` に入れる。
利用規約・プライバシーポリシーに載せる外部の問い合わせ窓口は `vars.CONTACT_URL` (`https://...` か `mailto:...`)。
未設定なら外部窓口の案内は出ない (サイト内の `/contact` への案内は常に出る)。
`/contact` から送信できるようにするには、bot 対策 (Cloudflare Turnstile) の鍵を 2 つとも入れる。
画面側は `vars.TURNSTILE_SITE_KEY`、検証側は秘匿値の `TURNSTILE_SECRET_KEY`。
どちらかが欠けていると画面が送信できない旨を出し、サーバーは 503 を返す。

### Web Push

フォロー一覧 (`/following`) のブラウザ通知には VAPID の鍵の組が要る。公開鍵は `vars.VAPID_PUBLIC_KEY`
(ローカルでは `.dev.vars` に書いて上書きしてよい)、秘密鍵は秘匿値の `VAPID_PRIVATE_KEY`。
送信時に push service へ名乗る連絡先は `vars.VAPID_SUBJECT` (`mailto:...` か `https://...`)。
公開鍵が空なら通知の区画は画面に出ない。秘密鍵か subject が空なら cron は送らずログに残す。
送信は `wrangler.jsonc` の `triggers` の cron で動き、送る内容は `GET /api/admin/push-digest`
(Bearer は `ADMIN_TOKEN`。`?at=` で起動時刻を指定できる) で送らずに下見できる。
鍵の組は Node で作れる (base64url の 2 行が出る):

```
node -e "const {generateKeyPairSync}=require('node:crypto');const {publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});const pub=publicKey.export({format:'jwk'});const b=s=>Buffer.from(s,'base64url');console.log('VAPID_PUBLIC_KEY='+Buffer.concat([Buffer.from([4]),b(pub.x),b(pub.y)]).toString('base64url'));console.log('VAPID_PRIVATE_KEY='+privateKey.export({format:'jwk'}).d)"
```

ホーム画面用のアイコン (`public/icons/`) は `public/favicon.svg` から `node scripts/generate-icons.mjs` で作る。

## コマンド

| コマンド | 何をするか |
|---|---|
| `npm run dev` | 開発サーバー (SSR) |
| `npm run check` | マイグレーション未適用の検出、文書とコメントの検査、画面の層の検査、型、lint、単体テスト。コミット前に通す |
| `npm run build` | 本番ビルド |
| `npm run preview` | ビルド成果物を Workers ランタイムで確認 |
| `npm run deploy` | build + wrangler deploy |
| `npm run test:e2e` | Playwright。E2E 専用の D1 を作り直して実行する。走らせるかの判定は `scripts/needs-e2e.sh` |
| `npm run db:generate` | スキーマの差分から `migrations/*.sql` を生成する。続けて適用まで行う |
| `npm run db:migrate:local` / `db:migrate:remote` | ローカル / 本番 D1 に適用 |
| `npm run db:export:local` | 手元の D1 の中身を本番に流し込める SQL に書き出す (既定で Audible を除く。理由は「本番 D1」) |
| `npm run db:export:actors` | 生成済みの声優リストから、既に D1 に居る声優のかな・ローマ字・性別を埋める SQL を書き出す (「本番 D1」) |
| `npm run db:import:remote -- <file>` | 書き出した SQL を本番 D1 に流し込む。人が実行する |
| `npm run db:restore:local -- --file <file> --yes` | 書き出した SQL から手元の D1 を作り直す (「本番 D1」)。中身はすべて入れ替わる |
| `npm run db:counts -- --local` / `--remote` | 表ごとの件数。流し込みの照合に使う |
| `npm run radar:crawl` | 声優起点のクローラー。オプションは `node crawler/run.ts --help` |
| `npm run radar:daily` | 新着一覧から日次で取り込む。オプションは `node crawler/daily.ts --help` |
| `npm run radar` | 1 人ぶんを調べる CLI。`node crawler/cli.ts --help` |
| `npm run radar:test` / `radar:typecheck` | crawler だけのテスト / 型検査 |
| `npm run cf-typegen` | `wrangler.jsonc` から `worker-configuration.d.ts` を再生成 |

## 本番 D1

正のデータと手元の D1 の位置づけは [`docs/architecture.md`](./docs/architecture.md) の「ローカル環境」。
Cloudflare の D1 は Workers Free プランでは Time Travel で 7 日しか遡れない (Paid は 30 日) ので、
`.github/workflows/d1-backup.yml` が週に 1 回スキーマ抜きで書き出して artifact に 90 日残す。
必要な GitHub Secrets は `CLOUDFLARE_API_TOKEN` (権限は Account の D1 の Edit だけ) と `CLOUDFLARE_ACCOUNT_ID`。
手元への復元は `npm run db:restore:local -- --file <artifact の sql> --yes`。マイグレーションを当てたうえで、
データの表への INSERT だけを親の表から順に流し込む (`scripts/d1-restore-local.mjs`)。

### 手元のデータを本番へ移す (初回だけ)

本番 D1 への書き込みは人が実行する。スキーマはマイグレーションで当て、データは書き出したものを流す。
書き出しにスキーマと `d1_migrations` の行は含めず、表は外部キーの親から順に並ぶ (`scripts/d1-data.mjs`)。

**2 日に分けて流す。** Free プランの D1 は 1 日に書ける行数に上限があり、索引への書き込みも数えるので、
手元の全件は 1 日に収まらない (2026-09-20 の見積もりは
[`docs/research/d1-migration-write-rows-2026-09-20.md`](./docs/research/d1-migration-write-rows-2026-09-20.md))。
`npm run db:export:local` が書き出しのたびに見積もりを出すので、その「合計」が
Cloudflare の料金ページの D1 の欄の上限に収まることを確かめてから流す。

1 日目 (声優と作品)

```bash
npx wrangler whoami                      # ログイン済みか。無ければ npx wrangler login
npm run db:counts -- --remote            # 本番が空であることを見る
npm run db:migrate:remote                # スキーマ
npm run db:export:local -- --output work/d1-export/day1.sql \
  --table voice_actors --table voice_actor_aliases --table audio_works \
  --table store_listings --table audio_credits --table crawl_runs
npm run db:import:remote -- work/d1-export/day1.sql
npm run db:counts -- --remote            # 書き出し時に出た件数と一致することを見る
```

2 日目 (アニメ)

```bash
npm run db:export:local -- --output work/d1-export/day2.sql \
  --table anime_titles --table anime_title_synonyms --table anime_appearances
npm run db:import:remote -- work/d1-export/day2.sql
npm run db:counts -- --remote
```

- 書き出しは既定で Audible の行を除く。listing と credit と取り込みの記録に加え、作品も除く
  (作品 ID がストアを含むため。判定は `scripts/d1-data.mjs` の `isExcludedRow`)。手元の Audible のデータには、
  2026-09-19 より前に robots.txt が禁じる並び順付き URL で取った分が混じっているため
  (`docs/stores/audible.md` の robots.txt の節)。手元との件数の差はこの除外ぶん
- 本番の Audible は初期構築 (対象声優の全員を声優起点で 1 回引く) で入れ直す
  ([`docs/decisions/0007-daily-crawl-from-store-feeds.md`](./docs/decisions/0007-daily-crawl-from-store-feeds.md))。
  それまでは Audible にしか作品が無い声優のページが出ない。月次の補完巡回は作品を持つ声優だけが対象なので、
  この層は月次では戻らない
- 流し込みは wrangler が 1 つの取り込みとして行い、途中で失敗すれば元の状態に戻る (wrangler がその旨を表示する)。
  失敗したら原因を直して同じファイルを流し直す

### 本番の声優のかな・ローマ字・性別を埋める

生成済みの声優リスト (`crawler/actors.generated.json`) から、本番に既に居る声優の `name_kana` /
`name_en` / `gender` を埋める。かなでの検索、英語表示のローマ字の名前と A-Z の索引、
声優一覧の性別の絞り込みは、この 3 列を見る。

書き出すのは `UPDATE` だけで、行を作らず、消さず、別名義の表には触れない
(`scripts/d1-export-actors.mjs`)。リストが値を持たない列は `SET` に入れないので、
本番に既に入っている値は消えない。

```bash
npx wrangler d1 execute DB --remote --command \
  "select count(name_kana) kana, count(name_en) en, sum(gender = 'unknown') unknown from voice_actors"
npm run db:export:actors                 # work/d1-export/actors.sql に書く
npm run db:import:remote -- work/d1-export/actors.sql
npx wrangler d1 execute DB --remote --command \
  "select count(name_kana) kana, count(name_en) en, sum(gender = 'unknown') unknown from voice_actors"
```

- 書き出しに出る「合計」が 1 日に書ける行数の上限に収まることを、流す前に確かめる
  (見方は「手元のデータを本番へ移す」と同じ)
- リストに居て本番に居ない声優の文は 0 行更新で通る。本番に声優の行を足すのは取り込み API
  (`src/server/queries/actors.ts` の `upsertActors`) の役目で、この SQL ではない
- 流した後も残る空欄は、リスト側が値を持たないぶん

### プランの確認

Cloudflare ダッシュボードの Workers & Pages → Plans で Free か Paid かを見る。Time Travel の保持日数が
変わるだけで、手順は同じ。

## クローラー

声優ごとにストアを巡回し、`POST /api/admin/ingest` で取り込む。相手サイトのレート制限は
`crawler/lib/fetch.ts` の 1 箇所で守る。外部サイトの制約は [`docs/stores/`](./docs/stores/)。

対象声優リストは AniList から生成した `crawler/actors.generated.json`。生成は `crawler/discovery/build-actors.ts`、
手で持つ情報 (かな、英語表記の訂正、検証済み別名、slug 衝突の解決) は `crawler/actors-overrides.json`。
かなは日本語版 Wikipedia からも取る (`crawler/discovery/wikipedia-kana.ts`)。

ポケドラは名前で検索できない (声優はタグで、一覧の URL に `tag_id` が要る) ので、声優タグ辞書
`crawler/pokedora-tags.generated.json` を経由して引く。辞書に無い声優はポケドラを引かない。
載っているのは一般 + BL に作品がある声優だけで、人数はこのファイルの要素数が正。

辞書は `crawler/discovery/pokedora-tags.ts` が全タグページを引いて `crawler/.cache/discovery/pokedora-tags.json`
に残した記録を切り詰めた生成物。切り詰めはネットワークに出ない。

```bash
# .cache の記録から辞書を作り直す
node crawler/discovery/build-pokedora-tags.ts
```

`.cache` の記録が無い環境では作り直せない。記録から取り直すところまで戻すなら
`node crawler/discovery/pokedora-tags.ts --resume` で、所要は
[`docs/stores/pokedora.md`](./docs/stores/pokedora.md) の「全件クロールのコスト」。

走行は 2 つある。**日次**はストアの新着一覧を引いて新作だけを取り込み、**声優起点**は初期構築と
月次の補完に使う (`docs/decisions/0007-daily-crawl-from-store-feeds.md`)。

GitHub Actions では日次が `.github/workflows/daily-crawl.yml` の cron で動く。声優起点の
`.github/workflows/crawl.yml` は手動実行だけで、定期実行は止めてある
(理由と戻す条件はワークフロー先頭のコメント)。

```bash
# 日次: 新着一覧から取り込む (dev サーバーを起動しておく)
INGEST_TOKEN=dev npm run radar:daily -- --base-url http://localhost:5199

# 声優起点: 取り込みまで通す
INGEST_TOKEN=dev npm run radar:crawl -- --base-url http://localhost:5199

# 一部の声優・1 つのストアだけ
INGEST_TOKEN=dev npm run radar:crawl -- --base-url http://localhost:5199 --only 上田麗奈,鬼頭明里 --store dlsite

# 取得だけ試す (DB へ送らない)
npm run radar:crawl -- --dry-run --only 上田麗奈
```

## 公開前の扱い

**画面に認証を掛けていない。** デプロイした時点で、URL を知っていれば誰でも見られる。
画面に出るのはストアと AniList の公開情報だけで、利用者の情報は持たない
(フォローはブラウザ内にしか無い。[`docs/decisions/0005-follow-state-in-browser.md`](./docs/decisions/0005-follow-state-in-browser.md))。

塞いでいるのは検索からの流入だけで、`robots.txt` が `Disallow: /` を返す。
公開するときに `wrangler.jsonc` の `vars.ALLOW_INDEXING` を `"1"` にして入れ替える
(判定は `src/server/robots.ts`)。

```bash
curl https://<本番の URL>/robots.txt
# 公開前:  User-agent: * / Disallow: /
# 公開後:  Disallow: /admin/ と /api/ だけ + Sitemap 行
```

> **Cloudflare Access (Zero Trust) を Worker の全体に掛けるとクローラーが通らない。**
> クローラーは `POST /api/admin/ingest` に書き込む経路しか持たず、送るのは Bearer トークンだけで、
> Access のログイン画面は解釈できない。外形監視 (`/api/crawler-freshness`) も同じ理由で通らなくなる。

## 外形監視

クロールが止まったことに気づく経路は 2 つある。**両方が要る。**

| 何が起きたか | 気づく経路 |
|---|---|
| 走行が失敗した | ワークフローが `crawl-failure` ラベルの Issue を立てる (開いていれば追記) |
| **cron が起動しなかった** | 外形監視。ワークフローが動かないので Issue も立たない |

2 つ目のために `GET /api/crawler-freshness` がある。ストアごとに日次の走行が成功した時刻を見て、
新しければ 2xx、古ければ 5xx を返す。認証は要らない。
監視サービスにはこの URL を登録し、**5xx で通知が飛ぶようにする**。本文を読む設定は要らない。
返す状態と判定の幅は `src/server/queries/freshness.ts` と
`src/app/routes/api/crawler-freshness.ts` が持つ。

```bash
curl -i https://<本番の URL>/api/crawler-freshness
```

**`/api/health` は使わない。** あちらは DB に触らない契約で、クロールが何日止まっていても
200 を返す。デプロイ後の疎通と E2E の起動待ち専用。

> **公開リポジトリの cron は、一定期間コミットが無いと GitHub が自動で止める。**
> 止まればワークフローが動かないので、上の Issue も立たない。
> 外形監視はこの場合にも鳴る経路になる。再開は Actions の画面から手で行う。
> (GitHub 側の挙動なので、通知の有無も期間もリポジトリからは確かめられない)

## ディレクトリ構成

```
crawler/         # Node スクリプト。src/domain にだけ依存する
├── adapters/    # ストアごとの取得と解析
├── discovery/   # 対象声優の発見と生成 (AniList / ポケドラの声優タグ辞書 / Wikipedia のかな)
├── fixtures/    # パーサーのテスト用に切り詰めた実 HTML / JSON
└── lib/         # fetch ラッパー、ingest クライアント
migrations/      # drizzle-kit が生成する SQL
e2e/             # Playwright
docs/            # ドキュメント (入口は docs/README.md)
scripts/         # npm run check から呼ぶ検査
src/
├── domain/      # 純粋な型・正規化・名寄せ・カテゴリ判定 (React / DB / fetch に依存しない)
├── server/      # Worker 側でだけ動くコード (D1 アクセス。クライアントから import 不可)
└── app/         # React (routes / pages / components / server-fns / store / lib / i18n / test)
```

依存方向と、それを守らせている仕組みは [`docs/architecture.md`](./docs/architecture.md)。
