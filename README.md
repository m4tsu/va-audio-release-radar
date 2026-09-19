# Voice Actor Audio Release Radar

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
| テスト | Vitest (`node` / `app` の 2 プロジェクト)、Playwright (E2E: `e2e/`) |
| Lint / Format | Biome |
| 配信 | Cloudflare Workers (`@cloudflare/vite-plugin`) |
| クローラー | Node.js 24 + cheerio (`crawler/`。Worker 内では動かさない) |

## ローカル開発

```bash
npm install
npm run db:migrate:local   # ローカル D1 にスキーマを作る
npm run dev                # ポートは vite.config.ts の server.port
```

秘匿値が要る機能 (取り込み・管理画面) を触るときは `.dev.vars.example` を `.dev.vars` にコピーして値を入れる。
canonical / og:url / `sitemap.xml` を本番の正規ホストに固定する場合は `wrangler.jsonc` の `vars.SITE_URL` に入れる。
利用規約・プライバシーポリシーの問い合わせ窓口は `vars.CONTACT_URL` (`https://...` か `mailto:...`)。未設定なら窓口の案内は出ない。

## コマンド

| コマンド | 何をするか |
|---|---|
| `npm run dev` | 開発サーバー (SSR) |
| `npm run check` | マイグレーション未適用の検出、文書とコメントの検査、型、lint、単体テスト。コミット前に通す |
| `npm run build` | 本番ビルド |
| `npm run preview` | ビルド成果物を Workers ランタイムで確認 |
| `npm run deploy` | build + wrangler deploy |
| `npm run test:e2e` | Playwright。E2E 専用の D1 を作り直して実行する |
| `npm run db:generate` | スキーマの差分から `migrations/*.sql` を生成する。続けて適用まで行う |
| `npm run db:migrate:local` / `db:migrate:remote` | ローカル / 本番 D1 に適用 |
| `npm run radar:crawl` | クローラー本体。オプションは `node crawler/run.ts --help` |
| `npm run radar` | 1 人ぶんを調べる CLI。`node crawler/cli.ts --help` |
| `npm run radar:test` / `radar:typecheck` | crawler だけのテスト / 型検査 |
| `npm run cf-typegen` | `wrangler.jsonc` から `worker-configuration.d.ts` を再生成 |

## クローラー

声優ごとにストアを巡回し、`POST /api/admin/ingest` で取り込む。相手サイトのレート制限は
`crawler/lib/fetch.ts` の 1 箇所で守る。外部サイトの制約は [`docs/stores/`](./docs/stores/)。

対象声優リストは AniList から生成した `crawler/actors.generated.json`。生成は `crawler/discovery/build-actors.ts`、
手で持つ情報 (かな、英語表記の訂正、検証済み別名、slug 衝突の解決) は `crawler/actors-overrides.json`。

定期実行は `.github/workflows/crawl.yml`。

```bash
# 取り込みまで通す (dev サーバーを起動しておく)
INGEST_TOKEN=dev npm run radar:crawl -- --base-url http://localhost:5199

# 一部の声優・片方のストアだけ
INGEST_TOKEN=dev npm run radar:crawl -- --base-url http://localhost:5199 --only 上田麗奈,鬼頭明里 --store dlsite

# 取得だけ試す (DB へ送らない)
npm run radar:crawl -- --dry-run --only 上田麗奈
```

## ディレクトリ構成

```
crawler/         # Node スクリプト。src/domain にだけ依存する
├── adapters/    # ストアごとの取得と解析
├── discovery/   # 対象声優の発見と生成 (AniList / ポケドラの声優タグ辞書)
├── fixtures/    # パーサーのテスト用に切り詰めた実 HTML / JSON
└── lib/         # fetch ラッパー、ingest クライアント
migrations/      # drizzle-kit が生成する SQL
e2e/             # Playwright
docs/            # ドキュメント (入口は docs/README.md)
scripts/         # npm run check から呼ぶ検査
src/
├── domain/      # 純粋な型・正規化・名寄せ・カテゴリ判定 (React / DB / fetch に依存しない)
├── server/      # Worker 側でだけ動くコード (D1 アクセス。クライアントから import 不可)
└── app/         # React (routes / server-fns / components / store / lib / i18n)
```

依存方向と、それを守らせている仕組みは [`docs/architecture.md`](./docs/architecture.md)。
