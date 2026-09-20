# アーキテクチャ

読者: コンポーネントをまたぐ変更をする前の人。境界と契約を確かめるときに読む
更新: コンポーネントの分割、依存方向、コンポーネント間の契約、不変条件が変わったら
削除: しない (製品が終わるまで)

何を作るかは [`product.md`](./product.md)。型・スキーマ・値・URL の形はコードが正で、ここには書かない。

## 構成要素

| 要素 | 実体 | 役割 |
|---|---|---|
| Worker | Cloudflare Workers + TanStack Start (SSR) + D1 | 画面、server functions、管理 API。**D1 に触るのはここだけ** |
| クローラー | Node.js (`crawler/`)。GitHub Actions の cron か手元で動く | ストアを取得して正規化し、Worker の管理 API に HTTP で送る。周期は下の「取得の周期」 |
| ブラウザ | React + IndexedDB (`src/app/store/`) | フォロー状態と既読の日時。アカウントが無いのでサーバーは知らない |
| 外部 | DLsite / Audible / ポケットドラマ CD / AniList | 制約は [`stores/`](./stores/) |

クローラーを Worker の中で動かさないのは、Workers からの外向き通信とサブリクエスト数の上限を避けるため。
クローラーが D1 に直接書かないのは、DB を触るコードを Worker 側 1 箇所に集約するため。

## 取得の周期

決定は [`decisions/0007`](./decisions/0007-daily-crawl-from-store-feeds.md)。

| 周期 | 起点 | 目的 | 走る場所 |
|---|---|---|---|
| 日次 | ストアの新着一覧 | 新作の検出。対象声優に当たった作品だけ保存する | GitHub Actions |
| 月次 | 作品を持つ声優 | 新着一覧の取りこぼしを埋める。検索の上限に当たった声優の洗い出し。DLsite の販売終了 | GitHub Actions |
| シーズンごと | AniList から増えた声優 | 新規声優の back catalog | GitHub Actions |
| 初回だけ | 対象声優の全員 | 初期構築。GitHub Actions のジョブ時間に収まらない | GitHub Actions の外 |

走行主体が複数になるので、同じホストの実行権は Worker が 1 つだけ貸し出し、取れなければ走らない。
日次の走行は件数が日ごとに揺れるため、健全性は前回比ではなく「直近に成功した取り込みがあるか」で見る。

## 依存方向

```
src/app  →  src/server  →  src/domain
crawler  →  src/domain
```

- `src/domain` は React / DB / fetch を知らない純粋な型と関数
- `crawler` は `src/app` と `src/server` を import しない。Biome の `noRestrictedImports` で止める
- `src/server` はクライアントバンドルに入らない。TanStack Start の import protection (`vite.config.ts`) で止める
- 列挙の値配列 (`src/domain/types.ts`) を DB スキーマの enum にそのまま渡す。DB 側で選択肢を再定義しない

## クローラーと Worker の契約

- 経路は `POST /api/admin/ingest` / `POST /api/admin/actors` / `GET /api/admin/known-ids`。すべて Bearer トークン
- 境界の検証は Zod (`src/domain/types.ts` の `ingestPayloadSchema`)。URL は `https:` のみ受け付ける。
  値はそのまま `<a href>` / `<img src>` に出るため
- **ペイロードに版 (`INGEST_PROTOCOL_VERSION`) を持つ。** 不一致なら Worker は 409 を返し、クローラーは
  残りを回さず走行を止める。クローラーは数時間走り、その間に Worker は差し替わりうるため
- **取得に失敗しても必ず送る。** 保存に失敗したら作品を外した最小ペイロードを送り直し、`crawl_runs` に残す。
  記録の無い失敗は「作品 0 件」と区別できない
- 「取得できた」と「保存できた」は別の事実として数える
- 取り込みは冪等。同じペイロードを送り直しても結果は変わらない (`first_seen_at` だけ初回の値を残す)。
  D1 に対話的トランザクションが無いので、部分的に書かれた状態は再送で直す
- 出演者名と対象声優の照合は Worker が行う。クローラーは照合しない。管理画面で足した別名義は Worker にしか無いため

## データの不変条件

- 作品 ID はストアを含む。ストア横断のマージはしない ([`product.md`](./product.md) の「対象作品」)
- 名寄せは完全一致と正規化一致だけ (`src/domain/identity.ts`)。複数の声優に一致したら unmatched にする。
  誤マッチより取りこぼしを選ぶ
- unmatched の credit は既存行の手動割り当てを上書きしない
- 保存する年齢区分は許可集合で決める。既定は R18 を含まない。読み取り側は R18 を除く形で絞る
  (許可制にすると区分不明のストアが丸ごと消える)
- 対象声優が 1 人も解決できない作品は保存しない。解決できた作品でも、検索対象の声優が credit に無ければ
  その声優への credit は作らない
- 対象声優でないと印を付けた出演者名は、再取り込みで印が消えない (手動割り当てと同じ扱い)
- 作品に価格と在庫状態を持たない ([`decisions/0008`](./decisions/0008-no-price-no-availability.md))
- 声優と作品に削除の経路を持たない ([`decisions/0009`](./decisions/0009-actor-list-append-only.md))。
  販売終了の作品を外すのは、ストアがそう示した場合だけ
- 日時は ISO 8601 文字列 (UTC)。新しさの判定 (段分け、NEW、未読) はサーバーが値で配る。
  クライアントで再計算すると SSR と時計が違って結果がずれる
- `IN` 句の値は `src/server/db/chunked.ts` で分割する。D1 の bound parameter 上限は単体テストの libsql では検出できない

## 外部アクセスの不変条件

- 外部への fetch は `crawler/lib/fetch.ts` の 1 箇所を通す。UA、ホストごとの間隔、スナップショット、タイムアウト、リトライをそこに集約する
- レートリミッタはプロセス内の状態。同じホストに 2 プロセスから同時にアクセスしない。
  走行主体が複数になったら、ホストごとの実行権を Worker から取ってから走る (「取得の周期」)
- 取得方法を変えるときは robots.txt を取り直し、引用を `stores/<store>.md` に残す
- ネットワークに出るテストは書かない。パーサーは `crawler/fixtures/` の固定データに対してテストする

## 画面と公開 API

ルートは `src/app/routes/` のファイル構成が正。画面データは server functions で取り、JSON を外に出すのは
`/api/health`、`/api/admin/*`、`sitemap.xml`、`robots.txt` だけ。
声優ページは検索エンジンのインデックス対象で、作品 0 件なら 404。フォロー一覧はブラウザごとに違うので noindex。

画面は 3 層に分かれ、依存は ルート (`src/app/routes/`) → ページ (`src/app/pages/`) → 部品 (`src/app/components/`)
の一方向。ルートは loader と head だけを持ち、画面を描かない。ページはデータを props で受け取る。
ルートは E2E が HTTP で、ページと部品は jsdom の隣接テストが検証する。
分担と E2E に残す範囲は [`.claude/rules/frontend.md`](../.claude/rules/frontend.md)、
検査は `scripts/check-app-layers.mjs` と `biome.json`。

## 秘匿値

`INGEST_TOKEN` (クローラー → 管理 API) と `ADMIN_TOKEN` (管理画面) を wrangler secret で持つ。
未設定なら該当機能は 503 を返し、トークン違いと区別できるようにする。ローカルは `.dev.vars`。

## ローカル環境

- 開発用 D1 (`.wrangler/state`) は同じマシンの全セッションが共有する
- E2E は専用の D1 とポートを使い、開発用に触らない (`playwright.config.ts`、`.claude/rules/e2e.md`)
- スキーマとマイグレーションは同時に適用する。未適用は `scripts/check-migrations.mjs` と hook が検出する

## 未実装

- 通知 (配信手段、ログイン時のフォロー同期)
- 本番デプロイ。本番 D1 を正にし、ローカルの D1 はその複製にする。それまでは「ローカル環境」の共有 D1 が正
- 「取得の周期」の日次・月次・シーズンごとの走行と、実行権の貸し出し、取り込みの鮮度の監視。
  現在のクローラーは声優起点の走行だけを持つ
- 「データの不変条件」のうち、対象声優が 1 人も解決できない作品の除外、対象外の印、価格と在庫状態の削除。
  現在の取り込みは検索結果の作品を全件保存し、価格を保存して作品ページに出している
