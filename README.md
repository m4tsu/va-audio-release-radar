# Koetrail

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

秘匿値が要る機能 (取り込み・管理画面・お問い合わせ・Web Push) を触るときは `.dev.vars.example` を
`.dev.vars` にコピーして値を入れる。各変数の意味と、空のときにどうなるかは `.dev.vars.example` と
`wrangler.jsonc` の `vars` のコメントが持つ。

### Web Push

VAPID 鍵の組は Node で作れる (base64url の 2 行が出る):

```
node -e "const {generateKeyPairSync}=require('node:crypto');const {publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});const pub=publicKey.export({format:'jwk'});const b=s=>Buffer.from(s,'base64url');console.log('VAPID_PUBLIC_KEY='+Buffer.concat([Buffer.from([4]),b(pub.x),b(pub.y)]).toString('base64url'));console.log('VAPID_PRIVATE_KEY='+privateKey.export({format:'jwk'}).d)"
```

送る内容は `GET /api/admin/push-digest` で送らずに下見でき、`POST /api/admin/push-test` で購読 1 件に
試しの通知を送れる (どちらも Bearer は `ADMIN_TOKEN`。引数は各ルートのファイルが持つ)。

## コマンド

`package.json` の scripts はすべてここに載せる (`check:docs` が照合する)。
本番に触るもの (★) は `CLAUDE.md` の「本番に触る操作」に従う。

| コマンド | いつ使うか |
|---|---|
| `npm run dev` | 開発サーバー (SSR) |
| `npm run check` | コミット前に必ず。下の `check:*`、型、lint、単体テストを順に流す |
| `npm run check:migrations` | ローカル D1 にマイグレーションの適用漏れが無いか |
| `npm run check:docs` | 文書とコメントの規則 (`.claude/rules/docs.md`) |
| `npm run check:layers` | 画面の 3 層の分担 (`.claude/rules/frontend.md`) |
| `npm run check:entrypoints` | 実行ファイルがどこから実行されるかを持っているか |
| `npm run typecheck` / `lint` / `lint:fix` | 型 / Biome の検査 / Biome の自動修正 |
| `npm run test` / `test:watch` | 単体テスト / その監視実行 |
| `npm run test:e2e` | Playwright。走らせるかの判定は `scripts/needs-e2e.sh` |
| `npm run e2e:prepare` | E2E 専用 D1 を作り直す。`test:e2e` が先に呼ぶ |
| `npm run db:reset:e2e` / `db:migrate:e2e` / `db:seed:e2e` | E2E 専用 D1 の作り直し・スキーマ・固定データを個別に行う |
| `npm run build` / `preview` | 本番ビルド / ビルド成果物を Workers ランタイムで確認 |
| `npm run deploy` | ★ build して本番へ出す |
| `npm run db:generate` | `schema.ts` の差分から `migrations/*.sql` を作る。適用は別に行う |
| `npm run db:migrate:local` / `db:migrate:remote` | ローカル / ★ 本番の D1 にマイグレーションを当てる |
| `npm run db:export:local` | 手元の D1 の中身を本番に流し込める SQL に書き出す (`--help`) |
| `npm run db:import:local -- <file>` / `db:import:remote -- <file>` | 書き出した SQL を手元 / ★ 本番の D1 に流し込む |
| `npm run db:restore:local -- --file <file> --yes` | 本番のバックアップから手元の D1 を作り直す。中身はすべて入れ替わる |
| `npm run db:counts -- --local` / `--remote` | 表ごとの件数。流し込みの照合に使う |
| `npm run db:check-name-variants` | `src/domain/normalize.ts` の異体字の対を足したら、手元の D1 の声優で別人が同じ鍵にならないかを数える |
| `npm run radar:daily` | 新着一覧から取り込む (日次のワークフローと同じ) |
| `npm run radar:crawl` | 声優起点のクロール (初期構築・月次・週次の新規声優) |
| `npm run radar:anilist` | AniList から対象声優とアニメを台帳に足す (週次と同じ) |
| `npm run radar:kana` | まだ引いていない声優のかなを取って台帳に入れる (週次と同じ) |
| `npm run radar:delist` | 台帳の DLsite 作品を引き直し、買えなくなったものを取り下げる (月次と同じ) |
| `npm run radar` | 1 人ぶんを調べる CLI |
| `npm run radar:pokedora-tags` | ポケドラの全タグページを引き直して声優タグの記録を作る。辞書に無い声優を足したいとき |
| `npm run radar:pokedora-tags:build` | 上の記録から `crawler/pokedora-tags.generated.json` を作り直す。ネットワークに出ない |
| `npm run radar:test` / `radar:typecheck` | crawler だけのテスト / 型検査 |
| `npm run cf-typegen` | `wrangler.jsonc` を変えたら `worker-configuration.d.ts` を作り直す |
| `npm run icons` | `public/favicon.svg` を変えたら `public/icons/` の PNG と `public/og-image.png` を作り直す |

クローラーのオプションは各ファイルの `--help` (`node crawler/run.ts --help` など)。
手元で流すときは dev サーバーを起動し、`INGEST_TOKEN=dev npm run radar:daily -- --base-url http://localhost:5199`
のように取り込み先を渡す。`--dry-run` なら送らずに結果だけ見られる。

## クローラーの運用

どの走行をいつ流すかは [`docs/architecture.md`](./docs/architecture.md) の「取得の周期」、
定期実行はそれぞれのワークフロー (`.github/workflows/daily-crawl.yml`、`weekly-anilist.yml`、
`monthly-backfill.yml`) と先頭のコメント。声優起点の `crawl.yml` は手動実行だけで、止めてある理由と戻す条件は
ファイル先頭のコメント。外部サイトの制約は [`docs/stores/`](./docs/stores/)。

手で直したい値 (かな、表示用ローマ字、公開状態) は `POST /api/admin/actor-attributes` に出どころ `editorial` で送る。
取り込みは自分の出どころの行しか書かないので、送った値は次の取り込みで消えない。
Wikipedia の記事が後からできた声優のかなを引き直すときは、`voice_actors.name_kana_checked_at` を消してから
`radar:kana` を走らせる。

## 本番 D1

`.github/workflows/d1-backup.yml` が週に 1 回スキーマ抜きで書き出して artifact に 90 日残す。
Workers Free プランの Time Travel は 7 日しか遡れないため (Paid は 30 日)。
必要な GitHub Secrets は `CLOUDFLARE_API_TOKEN` (権限は Account の D1 の Edit だけ) と `CLOUDFLARE_ACCOUNT_ID`。
手元への復元は `db:restore:local` で、手元の D1 の位置づけは `docs/architecture.md` の「ローカル環境」。

手元から本番へ流すときは、スキーマはマイグレーションで当て、データは `db:export:local` の書き出しを流す。
Free プランの D1 は 1 日に書ける行数に上限があり、索引への書き込みも数える。書き出しのたびに出る見積もりの
「合計」が Cloudflare の料金ページの上限に収まるかを確かめ、収まらなければ `--table` で表を分けて日を分ける
(2026-09-20 の見積もりは [`d1-migration-write-rows-2026-09-20.md`](./docs/research/d1-migration-write-rows-2026-09-20.md))。

## 公開前の扱い

**画面に認証を掛けていない。** デプロイした時点で、URL を知っていれば誰でも見られる。
塞いでいるのは検索からの流入だけで、`robots.txt` が `Disallow: /` を返す。
公開するときに `wrangler.jsonc` の `vars.ALLOW_INDEXING` を `"1"` にして入れ替える
(判定は `src/server/robots.ts`)。

> **Cloudflare Access (Zero Trust) を Worker の全体に掛けるとクローラーが通らない。**
> クローラーは Bearer トークンしか送れず、Access のログイン画面は解釈できない。
> 外形監視 (`/api/crawler-freshness`) も同じ理由で通らなくなる。

## 外形監視

クロールが止まったことに気づく経路は 2 つある。**両方が要る。**

| 何が起きたか | 気づく経路 |
|---|---|
| 走行が失敗した | ワークフローが `crawl-failure` ラベルの Issue を立てる (開いていれば追記) |
| **cron が起動しなかった** | 外形監視。ワークフローが動かないので Issue も立たない |

2 つ目のために `GET /api/crawler-freshness` がある。ストアごとに日次の走行が成功した時刻を見て、
新しければ 2xx、古ければ 5xx を返す。認証は要らない。監視サービスにはこの URL を登録し、
**5xx で通知が飛ぶようにする**。判定の幅は `src/server/queries/freshness.ts` が持つ。

**`/api/health` は使わない。** あちらは DB に触らない契約で、クロールが何日止まっていても
200 を返す。デプロイ後の疎通と E2E の起動待ち専用。

> **公開リポジトリの cron は、一定期間コミットが無いと GitHub が自動で止める。**
> 止まればワークフローが動かないので Issue も立たない。外形監視はこの場合にも鳴る。
> 再開は Actions の画面から手で行う。

## 計測

`docs/product.md` の「製品」の 2 つの率を、分母と分子で別々に数える
(決定は [`docs/decisions/0016-count-actions-in-analytics-engine.md`](./docs/decisions/0016-count-actions-in-analytics-engine.md))。

| 数えるもの | どこで数えるか | どこで見るか |
|---|---|---|
| 声優ページ・作品ページのページビュー (分母) | Cloudflare Web Analytics | ダッシュボードの Web Analytics。パスで絞る |
| フォロー・ストアへの送客の操作 (分子) | `/api/event` → Workers Analytics Engine (`src/server/usage-events.ts`) | 下の SQL API |

**`vars.WEB_ANALYTICS_TOKEN` が空ならどちらも数えない。** ダッシュボードの Web Analytics でサイトを足し
(JS スニペットを使う手動の設定)、表示されたトークンを package.json の `deploy` に `--var WEB_ANALYTICS_TOKEN:<トークン>`
で足す。`wrangler.jsonc` に書くと dev と E2E の操作まで数字に混ざる。

操作の数は Analytics Engine の SQL API で読む。トークンには `Account Analytics Read` の権限が要る。
データセット名は `wrangler.jsonc` の `analytics_engine_datasets`、列の割り当ては `src/server/usage-events.ts`。

```bash
curl "https://api.cloudflare.com/client/v4/accounts/<アカウント ID>/analytics_engine/sql" \
  --header "Authorization: Bearer <API トークン>" \
  --data "SELECT blob1 AS action, blob2 AS store, SUM(_sample_interval) AS count
          FROM voice_actor_audio_release_radar_events
          WHERE timestamp > NOW() - INTERVAL '7' DAY
          GROUP BY action, store"
```

## ディレクトリ構成

依存方向と、それを守らせている仕組みは [`docs/architecture.md`](./docs/architecture.md)。

```
crawler/         # Node スクリプト。src/contract と src/domain にだけ依存する
├── adapters/    # ストアごとの取得と解析
├── discovery/   # 対象声優とかなの入手 (AniList / ポケドラの声優タグ辞書 / Wikipedia)
├── fixtures/    # パーサーのテスト用に切り詰めた実 HTML / JSON
└── lib/         # fetch ラッパー、管理 API のクライアント
migrations/      # drizzle-kit が生成する SQL
e2e/             # Playwright
docs/            # ドキュメント (入口は docs/README.md)
scripts/         # npm run check から呼ぶ検査と、D1 の運用
src/
├── domain/      # 純粋な型・正規化・名寄せ・カテゴリ判定 (React / DB / fetch に依存しない)
├── contract/    # クローラー・画面と Worker の間でやり取りする形 (Zod スキーマと応答の型)
├── server/      # Worker 側でだけ動くコード (D1 アクセス。クライアントから import 不可)
└── app/         # React (routes / pages / components / server-fns / store / lib / i18n / test)
```
