# voice-actor-audio-release-radar

アニメに出演している声優をフォローすると、その人の音声作品を複数ストア横断で追えるサービス。
新着はめったに出ないので「頻繁に見るフィード」ではなく「鳴ったら確実に届く通知」として作る。

## 文書のどれが正か

- **設計の正は [`docs/design/architecture.md`](docs/design/architecture.md)**。実装で迷ったらここに従う
- 決定の履歴と、その理由は [`docs/design/decisions.md`](docs/design/decisions.md)
- 企画書 [`docs/development-plan.md`](docs/development-plan.md) は最初の草案で、**多くの決定が既に覆っている**。設計の根拠には使わない
- 文書の入口は [`docs/README.md`](docs/README.md)

## 同じ事実を 2 か所に書かない

- 同じ事実を 2 か所に書かない。出典を 1 つ決め、他はそこを指す
- 実装の値 (レート間隔、タイムアウト、リトライ回数、ポート、既定値) の出典は**コード**。ドキュメントやコメントに値を複製しない
- 測定値は必ず日付とセットで書く。日付の無い数字は古くなったことに誰も気づけない
- コードとドキュメントが食い違ったら、**動作を決めているコードが正**
- 経緯は [`docs/design/decisions.md`](docs/design/decisions.md) §19

## ローカルの共有資源

複数のセッションが同じリポジトリで並行して作業している。次はセッション間で共有される。

- **`.wrangler/state` のローカル D1 は全セッション共有**。一方が壊すと全員が落ちる
- **長時間のクローラーが動いていることがある**。着手前に `crawl_runs` の最新行を見て確認する:
  `npx wrangler d1 execute DB --local --command "select started_at, finished_at, store_slug from crawl_runs order by started_at desc limit 5"`
- **他のセッションの dev サーバーを止めない**。ポートで別セッションのものと判別できる。
  自分が起動していないポートのプロセスは触らない

## 外部サイトへのアクセス

- **`crawler/` を触る前に [`docs/stores/`](docs/stores/) の該当ファイルを読む**。robots.txt の引用・使ってよい URL・過去の誤りがまとまっている
- クローラーの外部アクセスは **`crawler/lib/fetch.ts` の 1 箇所を必ず通す**。adapter から素の `fetch` を呼ばない
- ホストごとの最小間隔は `crawler/lib/fetch.ts` の `rateLimitFor()` が持つ (根拠は [`docs/stores/`](docs/stores/) 該当ファイル §2)
- **レートリミッタはプロセス単位**。同じホストに 2 プロセスから同時アクセスしない。クロール中は同じストアを叩く別スクリプトを走らせない

## コミットしてはいけないもの

- `.dev.vars` (秘匿値。例は `.dev.vars.example`)
- `crawler/.cache/` (取得した生データ・前回結果)

どちらも `.gitignore` 済み。無視の指定を外さない。

## 主なコマンド

| コマンド | 何をするか |
|---|---|
| `npm run check` | typecheck + lint + test。コミット前にこれを通す |
| `npm run build` | 本番ビルド |
| `npm run test:e2e` | Playwright の E2E。E2E 専用の D1 (`.wrangler-e2e/`) を作り直して実行する |
| `npm run db:generate` | Drizzle のスキーマから migrations を生成する。**生成だけで止めない** |
| `npm run db:migrate:local` | 生成したマイグレーションをローカル D1 に適用する |
| `npm run radar:crawl` | クローラー本体。長時間動く |

マイグレーションの扱いには追加の規則がある。`migrations/` や `src/server/db/schema.ts` を
触るときは [`.claude/rules/migrations.md`](.claude/rules/migrations.md) が自動で読み込まれる。
同様に `e2e/` なら [`.claude/rules/e2e.md`](.claude/rules/e2e.md)、
`crawler/` なら [`.claude/rules/crawler.md`](.claude/rules/crawler.md) が読み込まれる。
