# Voice Actor Audio Release Radar

アニメに出演している声優をフォローすると、その人の音声作品を複数ストア横断 (DLsite / Audible …)
で追える Web サービス。アニメ本業の声優の音声作品は年に数本しか出ないので、
**カタログ全体を見せることが主**で、新着はめったに出ない。だから「頻繁に見に来るフィード」ではなく
「めったに鳴らないが、鳴ったら確実に届く通知」として作っている。
ASMR 推薦サイト・声優事典・価格追跡・AI 推薦のどれでもない。

**ドキュメントの入口は [`docs/README.md`](./docs/README.md)。**
実装するなら [`docs/design/architecture.md`](./docs/design/architecture.md) が正。

## 技術構成

| 領域 | 選定 |
|---|---|
| 言語 / ビルド | TypeScript strict, Vite, React 19 |
| フロント / SSR | TanStack Start (ファイルベースルート: `src/app/routes`) |
| UI | Tailwind v4, shadcn/ui (Radix ベース、`src/app/components/ui` にコード同梱) |
| DB | Cloudflare D1 (SQLite) + Drizzle ORM (`src/server/db`) |
| 検証 | Zod |
| テスト | Vitest (`node` / `app` の 2 プロジェクト)、Playwright (E2E: `e2e/`) |
| Lint / Format | Biome |
| 配信 | Cloudflare Workers (`@cloudflare/vite-plugin`。SSR とアセットを 1 つの Worker が処理) |
| クローラー | Node.js 24 + cheerio (`crawler/`。Worker 内では動かさない) |

## ローカル開発

```bash
npm install
npx wrangler d1 migrations apply DB --local   # ローカル D1 にスキーマを作る
npm run dev                                    # http://localhost:5199
```

秘匿値が要る機能 (取り込み・管理画面) を触るときは `.dev.vars.example` を
`.dev.vars` にコピーして値を入れる。`.dev.vars` は git 管理外。

canonical / og:url / `sitemap.xml` を本番の正規ホストに固定したい場合は、
`wrangler.jsonc` の `vars.SITE_URL` に `https://example.com` のように入れる。
空文字のままなら、実際に来たリクエストのオリジンを使う。

## コマンド

```bash
npm run dev              # 開発サーバー (SSR。ポート 5199)
npm run check            # 型・lint・単体テスト
npm run test:e2e         # Playwright (ローカル D1 にシードを入れて実行し、後で消す)
npm run build            # dist/client と dist/server を生成
npm run preview          # ビルド成果物を Workers ランタイムで確認
npm run deploy           # build + wrangler deploy
npm run cf-typegen       # wrangler.jsonc から worker-configuration.d.ts を再生成
npm run db:generate      # スキーマの差分から migrations/*.sql を生成
npm run db:migrate:local # ローカル D1 に適用
npm run db:migrate:remote# 本番 D1 に適用
npm run radar:test       # crawler だけのテスト
npm run radar:typecheck  # crawler だけの型検査 (Node 直接実行の構成を確かめる)
```

## クローラー

声優ごとに DLsite / Audible を巡回し、`POST /api/admin/ingest` で取り込む。
相手サイトのレート制限 (DLsite の `Crawl-delay: 10` など) は `crawler/lib/fetch.ts` の 1 箇所で守る。

声優リストは 2 つある。既定は手書きの暫定シード `crawler/actors.json` (35 人) で、
全員ぶんのクロールに 40 分前後かかる。本番の対象は AniList 由来の
`crawler/actors.generated.json` (2,569 人) で、こちらは `--actors` で指定する。
生成の規則は `crawler/discovery/`。

定期実行は `.github/workflows/crawl.yml` (毎日 05:00 JST + `workflow_dispatch`)。

```bash
# 取り込みまで通す (dev サーバーを起動しておく)
INGEST_TOKEN=dev npm run radar:crawl -- --base-url http://localhost:5199

# 一部の声優・片方のストアだけ
INGEST_TOKEN=dev npm run radar:crawl -- --base-url http://localhost:5199 \
  --only 上田麗奈,鬼頭明里 --store dlsite

# AniList 由来の全対象声優を使う
INGEST_TOKEN=dev npm run radar:crawl -- --base-url http://localhost:5199 \
  --actors crawler/actors.generated.json

# 取得だけ試す (DB へ送らない)
npm run radar:crawl -- --dry-run --only 上田麗奈

# 1 人ぶんを調べる (取り込みなし。前回との差分は diff)
npm run radar -- actor "上田麗奈"
```

## ディレクトリ構成

```
crawler/         # Node スクリプト (ストアの取得と正規化)。src/domain にだけ依存する
├── adapters/    # ストアごとの取得と解析 (dlsite / audible)
├── discovery/   # 対象声優の発見と生成 (AniList / 交差 / actors.generated.json)
├── fixtures/    # パーサーのテスト用に切り詰めた実 HTML / JSON
└── lib/         # fetch ラッパー、ingest クライアント
migrations/      # drizzle-kit が生成する SQL。wrangler d1 migrations apply で適用
e2e/             # Playwright
docs/            # ドキュメント (入口は docs/README.md)
src/
├── router.tsx   # TanStack Start が読む getRouter()
├── index.css    # Tailwind v4 + shadcn のテーマ変数
├── domain/      # 純粋な型・正規化・名寄せ・カテゴリ判定 (React / DB / fetch に依存しない)
├── server/      # Worker 側でだけ動くコード (D1 アクセス。クライアントから import 不可)
│   ├── db/      # schema.ts (Drizzle スキーマ)、client.ts (env.DB → drizzle)、chunked.ts
│   └── queries/ # 画面ごとの読み取り、ingest の upsert、管理画面
└── app/         # React
    ├── routes/       # ファイルベースルート。api/ 配下は server route (JSON)
    ├── server-fns/   # createServerFn の定義 (画面から呼ぶ)
    ├── components/   # 共通 UI (ui/ は shadcn 生成物)
    ├── store/        # フォロー状態 (Zustand + Dexie)
    └── lib/          # ユーティリティ
```

依存方向は `app → server → domain` と `crawler → domain` の一方向。逆流は Biome の
`noRestrictedImports` で、`src/server/**` のクライアントへの混入は TanStack Start の
import protection (`vite.config.ts`) で止める。
