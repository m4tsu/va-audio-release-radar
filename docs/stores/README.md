# 外部ストアの制約

このディレクトリは **クローラーを触る前に読む場所**。ストアごとに 1 ファイルあり、
robots.txt の引用、レート間隔、使ってよい URL の形、取得できる項目、過去の失敗を集めてある。

| ストア | ファイル | 状態 |
|---|---|---|
| DLsite (全年齢サイト `/home/`) | [`dlsite.md`](./dlsite.md) | 実装済み |
| Audible Japan | [`audible.md`](./audible.md) | 実装済み |
| ポケットドラマ CD | [`pokedora.md`](./pokedora.md) | 実装済み |
| AniList (ストアではなく声優の供給元) | [`anilist.md`](./anilist.md) | 実装済み |
| audiobook.jp | ファイルなし | **未着手**。規約照会の返信待ち。`docs/design/decisions.md` §13 |

## なぜこのディレクトリがあるか

外部サイトの制約という 1 種類の情報が、`design/architecture.md`・`research/*.md`・
`design/decisions.md` に散らばっていた。そのせいで **同じ種類の失敗を 4 回繰り返した**。

| # | 失敗 | 何が起きたか |
|---|---|---|
| 1 | DLsite の `per_page` | 「指定すると 0 件になる」と設計書に書いたが、実際は**無視される**だけだった。確かめずに記録していた |
| 2 | DLsite の `Crawl-delay` | robots に `Crawl-delay: 10` とあるのに、`product.json` を「軽い API だから」と 2 秒間隔で叩いていた |
| 3 | Audible の `page=` | 「robots が `page=` を禁じている」と読んだが、実際は `title=` / `keywords=` / `node=` / `sort=` **との組み合わせ**だけが禁止だった。使える手段を自分で潰していた |
| 4 | Audible の `sort=` | robots が `Disallow: /search?searchNarrator=*&sort=` と明確に禁じているのに、並び順 6 種類を実装した (2026-09-19 に同日中発覚、取り下げ) |

4 つとも「robots.txt の該当行を引かずに、記憶と推測で取得方法を決めた」ことが原因である。

## 守ること

### 1. 外部アクセスは `crawler/lib/fetch.ts` の 1 箇所を通す

adapter から素の `fetch` を呼ばない。UA・レート制限・スナップショット保存・タイムアウト・
リトライ (429 は `Retry-After` を尊重) をここに集約している。
**タイムアウトの秒数とリトライ回数も `fetch.ts` の定数が持つ。ここには写さない。**

### 2. 取得方法を変えるときは robots.txt の該当行を確認し、引用を残す

URL の形・パラメータ・ページングを変えるときは、**その時点の robots.txt を取り直し、
該当する `Disallow` / `Allow` の行をそのままこのディレクトリのファイルへ貼る**。
「たぶん大丈夫」「前に読んだときは大丈夫だった」で進めない。上の 4 件はすべてそれで起きた。

一致判定は字面で行う。`Disallow: /search*node=*searchNarrator=*page=` は `node=` を
必須にしているので `searchNarrator` + `page` だけの URL には一致しない、という読み方をする。
逆に、**パラメータの順序を入れ替えて字面の一致だけ外す**のは回避であって遵守ではない。
robots のコメント (`#Block alternative sort order for /search` など) に意図が書かれている場合、
意図の側に従う。

### 3. レート間隔を勝手に変えない

**間隔の値は `crawler/lib/fetch.ts` の `rateLimitFor()` が持つ。この README には書かない。**
秒数が知りたいならコードを読む。ここに写すと、コードを変えたときに片方だけ古くなる。

**なぜその値なのか**は、ホストごとに各ファイルの §2 にある。

| ホスト | 根拠を書いてある場所 |
|---|---|
| dlsite.com | [`dlsite.md`](./dlsite.md) §2 |
| audible.co.jp | [`audible.md`](./audible.md) §2 |
| pokedora.com | [`pokedora.md`](./pokedora.md) §2 |
| graphql.anilist.co | [`anilist.md`](./anilist.md) §2 |
| 上記以外 | 既定値。`rateLimitFor()` の最後の `return` |

短くするなら、相手が示した根拠 (robots の `Crawl-delay`、公開されている API 枠) を
先に §2 へ書き、そのうえで `rateLimitFor()` を変える。こちらの都合は根拠にならない。

### 4. レートリミッタはプロセス単位

`crawler/lib/fetch.ts` の `nextAllowedAt` は Node プロセス内の Map である。
**同じホストに 2 つのプロセスから同時にアクセスすると、実効間隔は半分になる。**
クロールや調査を始める前に、他のセッションが同じホストを叩いていないか確認する。

```
npx wrangler d1 execute DB --local --command \
  "select started_at, finished_at, store_slug from crawl_runs order by started_at desc limit 5"
```

`finished_at` が NULL で `started_at` が直近なら動いている可能性が高い。

### 5. robots.txt は変わる。四半期に一度は取り直す

取り直して差分を見て、**変化が無くても各ファイルの「最終確認日」を更新する**。
日付が古いままだと、書いてある引用がいつの時点のものか分からなくなる。
差分があったら、使っている URL がまだ許可されているかを 1 本ずつ突き合わせる。

次回の目安: **2026-12 月**。

## 書き方の統一

各ファイルは次の 8 つの見出しをこの順で持つ。空でも見出しは残し、「該当なし」と書く。

1. robots.txt — 最終確認日、該当行の引用、そこから導いた使ってよい形 / いけない形
2. レート間隔 — **なぜその値なのか**。robots の指定の有無、API 枠、実測。
   秒数そのものは `crawler/lib/fetch.ts` が持つので書かない
3. 使う URL — 実際に使っている形と、許可されていることの根拠
4. 使ってはいけない URL — 過去に間違えたものを含む
5. 取得できる項目 / できない項目 — 表。セレクタや JSON のキーを添える
6. 既知の落とし穴 — 実測で分かったこと
7. 未確認の項目 — 分かっていないことを明示する
8. 出典 — 根拠になった調査ノートへのリンク
