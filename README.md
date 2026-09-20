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

秘匿値が要る機能 (取り込み・管理画面) を触るときは `.dev.vars.example` を `.dev.vars` にコピーして値を入れる。
canonical / og:url / `sitemap.xml` を本番の正規ホストに固定する場合は `wrangler.jsonc` の `vars.SITE_URL` に入れる。
利用規約・プライバシーポリシーの問い合わせ窓口は `vars.CONTACT_URL` (`https://...` か `mailto:...`)。未設定なら窓口の案内は出ない。

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
| `npm run db:import:remote -- <file>` | 書き出した SQL を本番 D1 に流し込む。人が実行する |
| `npm run db:restore:local -- --file <file> --yes` | 書き出した SQL から手元の D1 を作り直す (「本番 D1」)。中身はすべて入れ替わる |
| `npm run db:counts -- --local` / `--remote` | 表ごとの件数。流し込みの照合に使う |
| `npm run radar:crawl` | クローラー本体。オプションは `node crawler/run.ts --help` |
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

### プランの確認

Cloudflare ダッシュボードの Workers & Pages → Plans で Free か Paid かを見る。Time Travel の保持日数が
変わるだけで、手順は同じ。

## クローラー

声優ごとにストアを巡回し、`POST /api/admin/ingest` で取り込む。相手サイトのレート制限は
`crawler/lib/fetch.ts` の 1 箇所で守る。外部サイトの制約は [`docs/stores/`](./docs/stores/)。

対象声優リストは AniList から生成した `crawler/actors.generated.json`。生成は `crawler/discovery/build-actors.ts`、
手で持つ情報 (かな、英語表記の訂正、検証済み別名、slug 衝突の解決) は `crawler/actors-overrides.json`。
かなは日本語版 Wikipedia からも取る (`crawler/discovery/wikipedia-kana.ts`)。

GitHub Actions からは `.github/workflows/crawl.yml` を手動で実行する。定期実行は止めてある
(理由と戻す条件はワークフロー先頭のコメント)。

```bash
# 取り込みまで通す (dev サーバーを起動しておく)
INGEST_TOKEN=dev npm run radar:crawl -- --base-url http://localhost:5199

# 一部の声優・1 つのストアだけ
INGEST_TOKEN=dev npm run radar:crawl -- --base-url http://localhost:5199 --only 上田麗奈,鬼頭明里 --store dlsite

# 取得だけ試す (DB へ送らない)
npm run radar:crawl -- --dry-run --only 上田麗奈
```

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
