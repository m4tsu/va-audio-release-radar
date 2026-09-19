# ドキュメントの入口

**設計の現状を知りたいなら [`design/architecture.md`](./design/architecture.md) だけを読めばよい。**
ほかの文書は、なぜそうなったかを追うためのもの。
**クローラーを触るなら、先に [`stores/`](./stores/) の該当ファイルを読む。**

執筆時に何をどこに書くかは [`.claude/rules/docs.md`](../.claude/rules/docs.md) にある。
同じ事実を 2 か所に書かないという一般原則は [`../CLAUDE.md`](../CLAUDE.md) にある。

## どれを何のために読むか

| 文書 | 何が書いてあるか | いつ読むか |
|---|---|---|
| [`design/architecture.md`](./design/architecture.md) | **現行の設計**。製品の定義、対象声優、技術構成、ドメインモデル、DB スキーマ、ストアごとの取得方法、画面、規約 | 実装する前に。迷ったらここが正 |
| [`design/decisions.md`](./design/decisions.md) | **決定の履歴**。いつ・なぜそう決めたか、何を覆したか。1 節 20 行以内 | 「なぜこうなっているのか」「これは検討済みか」を確かめたいとき |
| [`stores/`](./stores/) | **外部サイトの制約**。ストアごとに robots.txt の引用、**レート間隔の根拠** (値はコード)、使ってよい URL、セレクタ、既知の落とし穴、未確認の項目 | **`crawler/` を触る前に必ず**。取得方法を変えるときは引用を追記する |
| [`design/work-plan.md`](./design/work-plan.md) | タスクの進行記録、レビュー指摘、クロール結果、**ユーザーが行うこと**、次の作業 | 作業を始めるとき / 引き継ぐとき |
| [`feature-proposals/`](./feature-proposals/) | **提案**。まだ決まっていない案。価値と大まかな方向だけを書き、実装や仕様は書かない。却下した案もここに残す | 次に何を作るかを考えるとき |
| [`development-plan.md`](./development-plan.md) | 2026-09-18 の**最初の草案**。多くの決定が既に覆っている | 当初どう考えていたかを知りたいときだけ。設計の根拠には使わない |
| [`research/`](./research/) | 調査ノート。決定の根拠になった実測値 | 決定の数字を確かめたいとき |

## 読む順序

1. `design/architecture.md` §1〜§2 — 何を作っているか、誰を対象にしているか
2. `design/architecture.md` の残り — 実装に必要なことはすべてここにある
3. `design/work-plan.md` の「次の作業」— 今どこまで進んでいるか
4. 気になった決定があれば `design/decisions.md` の該当節 → そこからリンクされた調査ノート

クローラーを触るときは、この順の前に **`stores/<store>.md` を読む**。
robots.txt の該当行と、過去にそこで間違えたことが書いてある。

`development-plan.md` は最後に読むか、読まなくてよい。

`feature-proposals/` は**提案であって決定ではない**。設計の現状は `design/architecture.md` が正で、
提案は `design/decisions.md` に決定として書かれて初めて有効になる。

作業のルールはこのディレクトリではなく、リポジトリ直下の [`CLAUDE.md`](../CLAUDE.md) と
[`.claude/rules/`](../.claude/rules/) にある。前者は常に読み込まれ、後者は該当するファイルを触ったときに読み込まれる。

## 調査ノートが確定させたこと

| ノート | 確定させたこと |
|---|---|
| [`research/discovery-spike-2026-09-18.md`](./research/discovery-spike-2026-09-18.md) | 対象声優の規模。AniList 直近 12 シーズンの日本語声優 **2,569 人**、うち DLsite に全年齢音声がある声優は 57 人で 90 日 75 件 = 週 5.8 件。アニメでの役の多さと音声作品数は無相関 |
| [`research/store-survey-2026-09-18.md`](./research/store-survey-2026-09-18.md) | 追加ストアの優先順位。6 サイトの robots.txt と取得可否を調べ、**ポケットドラマ CD を次のストア**に決めた。audiobook.jp は規約第15条(15) により事前照会が要ると判明 |
| [`research/adult-scope-2026-09-18.md`](./research/adult-scope-2026-09-18.md) | 年齢区分の範囲。R18 は対象声優の作品を **1 件も増やさず**、Amazon アソシエイトのリスクだけがある。一方 BL は必須 (斉藤壮馬はポケドラ 143 件中 98 件)。DLsite からは別名義の根拠が得られないことも実測した |
| [`research/codex-differentiation-spec.md`](./research/codex-differentiation-spec.md) | 外部レビューによる差別化 3 案 (共演 / 出演形態 / 商業イベント)。実データで検証した結果 **出演形態だけを採用**した。フィードを濃くする方向の提案は実測と合わず採らなかった |
| [`research/otobank-inquiry-draft.md`](./research/otobank-inquiry-draft.md) | audiobook.jp への照会経路と文面。**未送信**。送るかどうかはユーザーが判断する |

調査ノートは実測の記録なので、後から書き換えない。
決定が覆った場合は `design/decisions.md` にそう書く。
