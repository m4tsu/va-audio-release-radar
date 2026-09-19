---
name: issue-new
description: 雑な依頼を、issue-batch が並列に流せる単位の issue に切り分け、テンプレートの欄を埋めて優先度と依存を付けて作る
argument-hint: "<やりたいことの説明>"
disable-model-invocation: true
---

# issue-new

引数の説明を、`.github/ISSUE_TEMPLATE/task.yml` の欄が埋まった issue にする。
本文の下書きは `work/issue-new/<slug>.md` (git 管理外)。作成は `scripts/create.sh`。

## 1. 照合

- `docs/product.md` の「作らない」に触れていないか。触れていれば作らずに報告する
- `docs/architecture.md` の境界 (依存方向、どこで動くか) に収まるか。収まらないなら、境界を変える決定が先に要ると報告する
- 重複: `gh issue list --state all --search "<キーワード>" --limit 20`。同じ目的の open issue があればそこに追記する案を出す
- 進行中との重なり: `gh issue list --label in-progress` と `gh issue list --label ready` を見て、同じ場所を触るものがあれば依存にする

## 2. 切り分け

1 issue は「Agent が 1 回の worktree で終え、レビューが差分だけで判定できる」大きさにする。規則:

- **スキーマ変更は単独の issue** にし、それを使う画面やクローラーは別 issue にして依存を張る。issue-batch はスキーマ変更を同時に 1 つしか動かさない
- **同じ画面を触るものは 1 つにまとめる**。ルート、その i18n、その E2E は分けない。分けると並列にならず、コンフリクトだけ増える
- **クローラーはストアごと**に分ける。`docs/stores/` に無いストアなら、先に制約を調べて文書にする issue を切る
- 文書だけの変更は、それを必要にする実装の issue に含める

依存は「先に main に入っていないと着手できない」ものだけ。順序の希望は優先度で表す。

## 3. 質問

受け入れ条件が書けない点、切り分けで読み方が分かれる点を集め、`AskUserQuestion` で 1 回にまとめて聞く。
2 つ以上に分けるときは、分け方 (タイトルと依存) もその質問に含めて確かめる。
聞く点が無ければ聞かない。

## 4. 本文を書く

欄ごとに書く。見出しはテンプレートと同じ。

```
### 目的
<利用者に何が起きるか。1〜2 行>

### 受け入れ条件
- <画面や CLI で確かめられる形>

### 範囲外
- <この issue でやらないこと。関連 issue があれば番号>

### 触る場所の見込み
- [x] src/app (画面・ルート・i18n)
- [ ] src/server (D1 クエリ・server-fns)
- [ ] スキーマ (migrations / src/server/db/schema.ts)
- [ ] crawler
- [ ] docs

### 依存
depends on #12
```

受け入れ条件は、Agent が実装の終わりを判定し、レビュアーが差分と照らす基準になる。
「〜できる」より「〜すると〜が表示される」の形で書く。型や値やセレクタは書かない (コードが持つ)。

## 5. 作る

依存される側から順に作る (番号が決まらないと `depends on` が書けない)。

```
bash .claude/skills/issue-new/scripts/create.sh "<タイトル>" work/issue-new/<slug>.md <p1|p2|p3> [ready]
```

- 優先度: `p1` 先に流す、`p2` 通常、`p3` 後回し。指定が無ければ `p2`
- `ready` は受け入れ条件が埋まっていて依存が無い (または依存先が閉じている) ときだけ付ける。
  依存先が open のものは `ready` を付けず、依存先が閉じたときに付ける

## 6. 報告

作った issue の番号・タイトル・優先度・依存を並べる。`ready` を付けなかったものはその理由を書く。
