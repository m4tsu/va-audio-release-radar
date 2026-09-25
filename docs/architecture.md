# アーキテクチャ

読者: コンポーネントをまたぐ変更をする前の人。境界と契約を確かめるときに読む
更新: コンポーネントの分割、依存方向、コンポーネント間の契約、不変条件が変わったら
削除: しない (製品が終わるまで)

何を作るかは [`product.md`](./product.md)。型・スキーマ・値・URL の形はコードが正で、ここには書かない。

## 構成要素

| 要素 | 実体 | 役割 |
|---|---|---|
| Worker | Cloudflare Workers + TanStack Start (SSR) + D1 | 画面、server functions、管理 API。**D1 に触るのはここだけ** |
| クローラー | Node.js (`crawler/`)。GitHub Actions か手元で動く | ストアを取得して正規化し、Worker の管理 API に HTTP で送る。周期は下の「取得の周期」 |
| ブラウザ | React + IndexedDB (`src/app/store/`) | フォロー状態と既読の日時。アカウントが無いのでサーバーは知らない。例外は通知 (Web Push) を購読したブラウザで、宛先と追う声優をサーバーに送り、フォローが変わるたびに送り直す ([`decisions/0013`](./decisions/0013-push-subscription-holds-follows-on-server.md)) |
| 外部 | DLsite / Audible / ポケットドラマ CD / AniList | 制約は [`stores/`](./stores/) |
| push service | ブラウザの提供元が運営する通知の配信サーバー | Worker が週 1 回の cron でダイジェストを送る相手。宛先は購読時にブラウザが告げる。Worker から外へ出る通信はこれとお問い合わせの bot 対策の 2 つ |

クローラーを Worker の中で動かさないのは、Workers からの外向き通信とサブリクエスト数の上限を避けるため。
クローラーが D1 に直接書かないのは、DB を触るコードを Worker 側 1 箇所に集約するため。

## 取得の周期

決定は [`decisions/0007`](./decisions/0007-daily-crawl-from-store-feeds.md) と [`decisions/0015`](./decisions/0015-db-is-the-ledger.md)。
**cron で自動に回るのは日次・週次・月次**で、残りは手で起動する (まだ無いものは「未実装」)。週次の対象シーズンは実行日から決め、範囲から外れた行は消さない。

| 周期 | 起点 | 目的 | 走る場所 |
|---|---|---|---|
| 日次 | ストアの新着一覧 | 新作の検出。対象声優に当たった作品だけ保存する | GitHub Actions |
| 週次 | AniList の直近 12 シーズン | 対象声優とアニメを台帳に足し、初めて見た声優の back catalog を引く | GitHub Actions |
| 月次 | 作品を持つ声優 | 新着一覧の取りこぼしを埋める。検索の上限に当たった声優の洗い出し | GitHub Actions。ストアごとに分け、DLsite はさらに声優 ID で組に分ける |
| 月次 | 台帳にある DLsite の作品 | 買えなくなった作品の取り下げ。検索結果には売っている作品しか出ないので、声優起点では観測できない | GitHub Actions。上の巡回と同じホストなので後ろに置く |
| 初回だけ | 対象声優の全員 | 初期構築。DLsite だけで GitHub Actions のジョブ時間を超えうる | GitHub Actions の外 |

走行主体が複数になるので、同じホストの実行権は Worker が 1 つだけ貸し出し、取れなければ走らない。
日次の走行は件数が日ごとに揺れるため、健全性は前回比ではなく「直近に成功した取り込みがあるか」で見る。
その判定は Worker が公開 API で答え、外部の監視がそれを見る (cron の不起動は Worker 側でしか分からない)。

## 通知の送信

決定は [`decisions/0013`](./decisions/0013-push-subscription-holds-follows-on-server.md)。
Worker の cron が週 1 回、購読ごとに「追う声優のその週の新作」を集め、あれば 1 通だけ Web Push で送る。
新作の判定はフィードの「最近の新作」と同じ規則で、範囲が前の予定時刻からこの予定時刻までになる。
発売日がその週より前でもその週に初めて見つかった作品は数える (取り込みが週の締めに遅れても落とさない)。
1 回の起動で送る数に上限を置き、残りは同じ日の次の起動に持ち越す (Workers の外向き通信の上限のため)。
どの起動も同じ予定時刻に丸め、送り済みの購読と送っても通らない購読には予定時刻を印として付けるので、
2 通は出ず、通らない購読が送信枠を占め続けることもない。
push service が失効を返した購読はその場で消す。走行ごとの結果は D1 に 1 行残す (途中で止まっても件数は書く)。
送る内容は管理 API で送らずに下見できる。段取りは `src/server/push/`、cron の時刻は `wrangler.jsonc` の `triggers`。

## 依存方向

```
src/app  →  src/server  →  src/contract  →  src/domain
crawler  ─────────────────→  src/contract  →  src/domain
```

- `src/domain` は React / DB / fetch / Zod を知らない純粋な型と関数
- `src/contract` はコンポーネントの間を行き来する形 (Zod スキーマと応答の型) だけを持つ。
  送る側と受ける側が同じ定義を import するので、片側だけ形を変えると型検査で落ちる
- `crawler` は `src/app` と `src/server` を import しない。Biome の `noRestrictedImports` で止める
- `src/server` はクライアントバンドルに入らない。TanStack Start の import protection (`vite.config.ts`) で止める
- 列挙の値配列 (`src/domain/types.ts`) を DB スキーマの enum にそのまま渡す。DB 側で選択肢を再定義しない

## クローラーと Worker の契約

- 経路と、送る形・返る形は `src/contract/admin-api.ts` の `AdminApi` が持つ。クローラーはそこに無い経路を
  呼べない。すべて Bearer トークン
- **声優の ID と slug を決めるのは Worker。** 取り込みが受け取るのは供給元が言っている値だけで、slug の衝突は
  今ある全員と突き合わせて解く。誰を調べるかもクローラーは Worker に聞く (台帳は DB にしかない)
- 境界の検証は `src/contract` の Zod スキーマ。URL は `https:` のみ受け付ける (値はそのまま `<a href>` / `<img src>` に出るため)
- **ペイロードに版 (`INGEST_PROTOCOL_VERSION`) を持つ。** 不一致なら Worker は 409 を返し、クローラーは残りを
  回さず止まる。クローラーは数時間走り、その間に Worker は差し替わりうるため
- **取得に失敗しても必ず送る。** 保存に失敗したら作品を外した最小ペイロードを送り直し、`crawl_runs` に残す。
  記録の無い失敗は「作品 0 件」と区別できない。「取得できた」と「保存できた」は別の事実として数える
- 取り込みは冪等。同じペイロードを送り直しても結果は変わらない (初めて見た日時だけ初回の値を残す)。
  D1 に対話的トランザクションが無いので、部分的に書かれた状態は再送で直す
- 出演者名と対象声優の照合は Worker が行う (管理画面で足した別名義は Worker にしか無い)
## データの不変条件

- 作品 ID はストアを含む。ストア横断のマージはしない ([`product.md`](./product.md))
- 名寄せは完全一致と正規化一致だけ。複数に一致したら unmatched にし (誤マッチより取りこぼしを選ぶ)、unmatched の credit は手動割り当てを上書きしない (`src/domain/identity.ts`)
- 保存する年齢区分は許可集合で決める。既定は R18 を含まず、読み取り側も R18 を除く形で絞る
  (許可制にすると区分不明のストアが丸ごと消える)
- 声優に紐付かない走行 (新着一覧) では、対象声優が 1 人も解決できない作品を保存しない。声優起点の走行では保存する
- 対象声優でないと印を付けた出演者名は、再取り込みで印が消えず、未解決キューにも出ない
- 作品に価格と在庫状態を持たない ([`decisions/0008`](./decisions/0008-no-price-no-availability.md))。ストアが販売終了を明示した listing だけ取り下げ、一覧に出ないことを理由にはしない
- 取り下げた listing は行を消さず、読むときに落とす。どのストアでも買えなくなった作品だけ一覧から消える
- 声優と作品に削除の経路を持たない ([`decisions/0009`](./decisions/0009-actor-list-append-only.md))。取り下げも
  行は残す。AniList の取得範囲は取りに行く範囲を絞る条件で、範囲外の声優・作品・出演も台帳に残る
- **声優のデータは 3 種類に分けて持つ** (`src/server/db/schema.ts`)。**同一性** (staff id / ID / slug / 初めて見た
  日時) は作られた後に変えない。**供給元の写し** は取り込みが今回言った項目だけを上書きし、言わなかった項目は
  触らない (別の経路が埋めた値を消さないため)。**付加情報** は 声優 × 属性 × 出どころ で 1 行を持ち、
  書き手は自分の出どころの行しか触らない
- **出どころが 1 つに決まる値は列に、複数ありうる値は付加情報の表に置く。** 表記・性別・画像は AniList しか言わないので列。かなは AniList が持たず Wikipedia と人から来るので表。ローマ字は両方あるので列 + 表
- **付加情報は読むときに、属性ごとの出どころの優先順位で 1 つ選ぶ** (`src/server/queries/actor-attributes.ts`)。
  順位は読み取り側が 1 か所に持ち、並べていない出どころの行は選ばない。手で書いたものが先に来るので、
  訂正は行を足すだけで表に出て、取り込みで消えない
- 日時は ISO 8601 文字列 (UTC)。新しさの判定 (段分け、NEW、未読) はサーバーが値で配る (クライアントで再計算すると SSR と時計が違う)
- `IN` 句の値は `src/server/db/chunked.ts` で分割する。D1 の bound parameter 上限は単体テストの libsql では検出できない

## 外部アクセスの不変条件

- 外部への fetch は `crawler/lib/fetch.ts` の 1 箇所を通す。UA、ホストごとの間隔、スナップショット、タイムアウト、リトライをそこに集約する。
  `crawler/lib/` の外で素の `fetch` を呼ぶと Biome が落とす
- レートリミッタはプロセス内の状態。同じホストに 2 プロセスから同時にアクセスしない。走行主体が複数になったら、
  ホストごとの実行権を Worker から取ってから走る (「取得の周期」)
- 取得方法の変え方とテストの書き方は `.claude/rules/crawler.md`

## 画面と公開 API

ルートは `src/app/routes/` のファイル構成が正。画面データは server functions で取り、HTML 以外を外に出すのは
`/api/health`、`/api/crawler-freshness`、`/api/admin/*`、`sitemap.xml`、`robots.txt`、`manifest.webmanifest`
(ホーム画面用。言語 cookie で中身が変わる) と、`public/` の静的ファイル (`sw.js` は通知を表示するだけの
service worker で、ページの資産をキャッシュしない) だけ。画面が利用者のブラウザに外から読み込ませるもの
(表紙画像、bot 対策、アフィリエイトの計測画像) は `src/app/legal/privacy.ts` の外部通信の記述と揃える。
このうち認証が要るのは `/api/admin/*` だけで、鮮度の判定は外形監視から見えるように開けてある。
利用者から受け取る経路は 2 つ。お問い合わせ (`/contact`) は認可の代わりに bot 対策 (Cloudflare Turnstile)
の検証を通す。検証の失敗と鍵の未設定を応答で分ける。フォロー情報は添えない。もう 1 つは通知の購読 (`/following` の server functions) で、ブラウザが push service
から受け取った宛先とフォロー中の声優 ID を保存する。認可は無く、Zod で形と件数を絞り、偽の宛先は送信時の
失効で消える。宛先は利用者の識別に使わない (`src/server/db/schema.ts` の `push_subscriptions`)。
声優ページとアニメのページは、音声作品があればインデックス対象、無ければ noindex で
sitemap にも出さない。声優は音声作品も出演アニメも無ければ 404、アニメは出演が無ければ 404。
フォロー一覧はブラウザごとに違うので noindex。
Worker の前のキャッシュに載せるのは誰が見ても同じ応答だけで、既定は載せない。Worker を通ってデータを変えた
書き込みの後はすべて消す (D1 へ直接流した変更では消えない)。公開データのクエリ結果も本番では Cache API に置き、
同じ書き込みの後にデータの世代を上げてから消す (`src/server/cache-policy.ts`、`src/server/data-cache.ts`)。

画面は 3 層に分かれ、依存は ルート (`src/app/routes/`) → ページ (`src/app/pages/`) → 部品 (`src/app/components/`)
の一方向。ルートは loader と head だけを持ち、画面を描かない。ページはデータを props で受け取る。
ルートは E2E が HTTP で、ページと部品は jsdom の隣接テストが検証する。
分担と E2E に残す範囲は [`.claude/rules/frontend.md`](../.claude/rules/frontend.md)、
検査は `scripts/check-app-layers.mjs` と `biome.json`。

## 秘匿値

秘匿値は wrangler secret で持ち、一覧と用途は `.dev.vars.example` (ローカルは `.dev.vars`)。
未設定なら該当機能は 503 を返し、トークン違いや検証の失敗と区別できるようにする。
公開してよい設定は `wrangler.jsonc` の `vars` で、空のときの振る舞いはそのコメントが持つ。

## ローカル環境

- 正のデータは本番 D1。開発用 D1 (`.wrangler/state`) はその複製で、同じマシンの全セッションが共有する。
  本番の書き出しから作り直せる (`README.md` の「本番 D1」)。本番の控えは週次の書き出し (`.github/workflows/d1-backup.yml`)
- E2E は専用の D1 とポートを使い、開発用に触らない (`playwright.config.ts`、`.claude/rules/e2e.md`)
- スキーマとマイグレーションは同時に適用する。未適用は `scripts/check-migrations.mjs` と hook が検出する

## 未実装

- ログイン時のフォロー同期
- 「取得の周期」の実行権の貸し出し。日次・週次・月次は動いている
- 対象外の印を人が付ける経路。印を持つ表と、キューや解決し直しから外す側は入っているが、管理画面の操作がまだ無い
