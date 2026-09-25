# 外部ストアの制約

読者: `crawler/` を触る前の人。どのストアのファイルを読むかを決めるときに読む
更新: ストアを足したり外したりしたら。見出しの型を変えたら
削除: しない

外部サイトの制約は、記憶や以前の読みで判断すると誤る。相手が何を許しているか
(robots.txt と利用規約の引用) と、こちらがなぜそうするか (レート間隔の根拠、使ってはいけない URL、
実測で分かった落とし穴) を、ストアごとに 1 ファイルに集めてある。

使う URL の形、取れる項目、セレクタ、間隔の秒数はここに書かない。adapter のコード
(`crawler/adapters/`、`crawler/discovery/`、`crawler/lib/fetch.ts`) が持つ。
実装されているかどうかも `crawler/` を見れば分かるので、この表には持たない。

| 相手 | ファイル |
|---|---|
| DLsite | [`dlsite.md`](./dlsite.md) |
| Audible Japan | [`audible.md`](./audible.md) |
| ポケットドラマ CD | [`pokedora.md`](./pokedora.md) |
| AniList (ストアではなく声優の供給元) | [`anilist.md`](./anilist.md) |
| ステラプレイヤー | [`stellaplayer.md`](./stellaplayer.md) |
| Wikimedia (ストアではなく声優のかなの入手元) | [`wikimedia.md`](./wikimedia.md) |
| HoYoverse の公式サイト (ストアではなくゲームのキャストの供給元) | [`hoyoverse.md`](./hoyoverse.md) |
| ゲームの公式サイト (HoYoverse 以外。ゲームのキャストの供給元) | [`game-official-sites.md`](./game-official-sites.md) |
| GameWith (ストアではなく鳴潮のキャストの供給元) | [`gamewith.md`](./gamewith.md) |
| audiobook.jp | ファイルなし。利用規約が「事前の許可なく情報解析をする行為」を禁じており、運営元への照会が済むまで着手しない |

クローラーを触るときの手順 (robots.txt の確認、レート間隔の変え方、プロセス単位のレートリミッタ) は
`.claude/rules/crawler.md`。

## 各ファイルの見出し

h2 は `scripts/check-docs.mjs` の `STORE_HEADINGS` の順で、これ以外を置かない。`check:docs` が検査する。
空でも見出しは残し、「該当なし」と書く。

- robots.txt: 最終確認日、該当行の引用、利用規約の引用、そこから導いた使ってよい形 / いけない形
- レート間隔: なぜその値なのか。robots の指定の有無、API 枠、実測。秒数は書かない
- 使ってはいけない URL: 過去に間違えたものを含む
- 既知の落とし穴: 実測で分かったこと。日付か `docs/research/` へのリンクを添える
- 未確認の項目: 分かっていないことを明示する
- 出典: 根拠になった調査ノートへのリンク

## robots.txt は四半期に一度取り直す

取り直して差分を見て、変化が無くても各ファイルの最終確認日を更新する。
日付が古いままだと、書いてある引用がいつの時点のものか分からなくなる。
差分があったら、adapter が組み立てる URL がまだ許可されているかを 1 本ずつ突き合わせる。

次回の目安: 2026-12 月。
