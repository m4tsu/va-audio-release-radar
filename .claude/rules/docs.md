---
description: docs/ に何をどう書くか。同じ事実を2か所に書かない一般原則は CLAUDE.md にある
paths:
  - "docs/**"
  - ".claude/rules/**"
  - "CLAUDE.md"
  - "README.md"
---

# ドキュメントの規則

**同じ事実を 2 か所に書かないという一般原則は [`../../CLAUDE.md`](../../CLAUDE.md) にある。**
ここに書くのは、この docs/ 配下に固有の配置ルールだけ。

## 何をどこに書くか

書く前にこの表で行き先を決める。**同じ種類の情報を 2 か所に置かない。**

| 情報の種類 | 置き場所 | 例 |
|---|---|---|
| 現在の設計 | [`docs/design/architecture.md`](../../docs/design/architecture.md) | ドメインモデル、DB スキーマ、画面、取得の方針 |
| 決定と、その理由 | [`docs/design/decisions.md`](../../docs/design/decisions.md) | **短く**。1 節 20 行以内。詳細はリンクで飛ばす |
| 外部サイトの制約 | [`docs/stores/<store>.md`](../../docs/stores/) | robots.txt の引用、URL の形、セレクタ、落とし穴 |
| 日付入りの測定 | [`docs/research/`](../../docs/research/) | 実測値、調査の手順。**後から書き換えない** |
| 作業のルール | [`CLAUDE.md`](../../CLAUDE.md)、[`.claude/rules/`](../../.claude/rules/) | 前者は常時、後者は該当ファイルを触ったときだけ |
| 未決の提案 | [`docs/feature-proposals/`](../../docs/feature-proposals/) | 決まったら `design/decisions.md` に決定として書く |
| タスクの進行 | [`docs/design/work-plan.md`](../../docs/design/work-plan.md) | 次の作業、レビュー指摘、ユーザーが行うこと |

## 根拠・測定値はどこに書くか

実装の値そのものの出典はコード (原則は CLAUDE.md)。docs に書くのは次の 2 つだけ。

| 事実の種類 | 出典 |
|---|---|
| なぜその値なのか (robots の引用、API 枠、判断の理由) | [`docs/stores/<store>.md`](../../docs/stores/) の §2 など |
| 測定値 (人数、作品数、所要時間、カバー率) | [`docs/research/`](../../docs/research/) の日付入りノート |

## 決定の履歴に何でも書かない

`docs/design/decisions.md` に置くのは決定の内容・日付・なぜそう決めたか・何を覆したか・詳細へのリンクだけ。
**1 節 20 行以内。** セレクタや robots の引用は `docs/stores/` へ、実測値の分布や上位 N の一覧は `docs/research/` へ行く。
経緯は [`docs/design/decisions.md`](../../docs/design/decisions.md) §19。

## 外部サイトの制約は `docs/stores/` に集約する

ストアごとの robots.txt の引用・使ってよい URL・セレクタ・落とし穴は `docs/stores/<store>.md` にまとめる。
以前は同じ情報が複数の文書に散らばり、robots.txt の読み違いによる同種の失敗を 4 回繰り返した。
経緯は [`docs/stores/README.md`](../../docs/stores/README.md)、[`docs/design/decisions.md`](../../docs/design/decisions.md) §18。
