# voice-actor-audio-release-radar

アニメに出演している声優をフォローすると、その人の音声作品を複数ストア横断で追えるサービス。
何を作るかは [`docs/product.md`](docs/product.md)、システムの境界は
[`docs/architecture.md`](docs/architecture.md)。文書の入口は [`docs/README.md`](docs/README.md)。

## 文書とコメント

- git に入る文書とコメントは最終成果物。書いた日の会話を知らない読者が、リポジトリだけで
  検証できることだけを書く。置き場所の判定表と禁止語は [`.claude/rules/docs.md`](.claude/rules/docs.md)
- コードコメントは「なぜこの行か」だけ。何が起きたか、何回目か、誰が決めたかはコミットメッセージに書く
- 他の文書を節番号 (`§N`) やタスク ID で指さない。ファイル名と見出し語で指す
- 型・スキーマ・値・URL の形の出典はコード。文書に写さない。測定値は日付とセットで `docs/research/` にだけ書く
- 進行、次の作業、ユーザーへの依頼、未決の提案は git 管理外の `work/` に書く

## ローカルの共有資源

複数のセッションが同じリポジトリで並行して作業している。次はセッション間で共有される。

- **`.wrangler/state` のローカル D1 は全セッション共有**。正のデータは本番 D1 で、ローカルはその複製。
  壊したら `npm run db:restore:local` で本番の書き出しから作り直す (`README.md` の「本番 D1」)。
  作り直すと他のセッションの見ているデータも入れ替わるので、クロール中や作業中のセッションが無いことを確かめてから行う
- **長時間のクローラーが動いていることがある**。`crawl_runs` は取り込みが終わった時点で 1 行書かれるので
  実行中の行は無い。直近の `started_at` が数分以内なら別プロセスが動いている可能性が高い:
  `npx wrangler d1 execute DB --local --command "select started_at, store_slug from crawl_runs order by started_at desc limit 3"`
- **他のセッションの dev サーバーを止めない**。自分が起動していないポートのプロセスは触らない

## 画面

画面は ルート (`src/app/routes/`) → ページ (`src/app/pages/`) → 部品 (`src/app/components/`) の 3 層。
ルートは loader と head だけを持ち、画面は描かない。ページと部品にはテストを隣に置く。
E2E に書くのは SSR の応答・ハイドレーション・ブラウザ保存・cookie の 4 つだけ。
分担と理由は [`.claude/rules/frontend.md`](.claude/rules/frontend.md)。

## 外部サイトへのアクセス

- **`crawler/` を触る前に [`docs/stores/`](docs/stores/) の該当ファイルを読む**
- クローラーの外部アクセスは **`crawler/lib/fetch.ts` の 1 箇所を必ず通す**。adapter から素の `fetch` を呼ばない
- ホストごとの最小間隔は `crawler/lib/fetch.ts` の `rateLimitFor()` が持つ。根拠は `docs/stores/` 該当ファイルの「レート間隔」
- **レートリミッタはプロセス単位**。同じホストに 2 プロセスから同時にアクセスしない

## コミットしてはいけないもの

`.dev.vars` (秘匿値。例は `.dev.vars.example`)、`crawler/.cache/` (取得した生データ)、`work/` (作業状態)。
いずれも `.gitignore` 済み。無視の指定を外さない。

## issue からの作業

`/issue-new <説明>` で依頼を issue に切り分ける (欄は `.github/ISSUE_TEMPLATE/task.yml`)。
`/issue-task <issue 番号 | 要件の文章>`。worktree を切り、実装・レビュー・main への fast-forward マージまでを
一続きで行う。手順と、node_modules / ローカル D1 の複製方法は `.claude/skills/issue-task/SKILL.md`。
`/issue-batch` は `ready` ラベルの issue を集め、issue ごとに Agent を起動して同じ手順を並列に回す司令塔。
手順は `.claude/skills/issue-batch/SKILL.md`。

## コマンド

一覧は [`README.md`](README.md) の「コマンド」。コミット前に `npm run check` を通す。
`migrations/` や `src/server/db/schema.ts`、`e2e/`、`crawler/`、`src/app/` を触るときは
`.claude/rules/` の該当ファイルが自動で読み込まれる。
