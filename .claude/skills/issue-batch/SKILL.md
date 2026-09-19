---
name: issue-batch
description: ready ラベルの issue を集め、issue ごとに worktree 付きの Agent を起動して issue-task の手順で実装させ、マージと push を 1 つずつ進める司令塔
argument-hint: "[--parallel N] [issue 番号...]"
disable-model-invocation: true
---

# issue-batch

司令塔として動く。自分ではコードを書かず、main の作業ツリーも編集しない。
引数の `--parallel N` は同時に動かす Agent の数 (既定 2)。番号を並べればその issue だけ、
無ければ `ready` ラベルの open issue すべてが対象。
スクリプトは `.claude/skills/issue-batch/scripts/`。issue のラベルは `ready` → `in-progress` → (`needs-input` | `failed`) → 閉じる、と動く。

## 1. 前提の確認

```
bash .claude/skills/issue-batch/scripts/preflight.sh
```

main ブランチで、origin/main に遅れておらず、未コミットの変更が無いこと。未コミットがあれば止めて報告する。

## 2. 収集

```
bash .claude/skills/issue-batch/scripts/collect.sh [番号...]
```

`work/issue-batch/<run>/issues.json` に本文が入る。出力の `RUN_DIR` 以下を、この実行の記録に使う。

## 3. トリアージ (司令塔が自分で行う)

各 issue の本文を読み、次を決めて `<RUN_DIR>/plan.md` に表で書く。
列は issue / 状態 / スキーマ変更 / 依存 / Agent 名 / worktree / 備考。状態は 未着手 / 実行中 / マージ待ち / 入力待ち / 完了 / 失敗。

- **質問**: issue-task の「要件」で聞く条件に当てはまる点を全 issue ぶん集め、`AskUserQuestion` で 1 回にまとめて聞く。
  Agent は途中でユーザーに質問できない。答えは `gh issue comment <N> --body` で issue に書く (Agent はコメントも読む)
- **スキーマ変更**: `migrations/` を増やすと見込む issue に印を付ける。同時に動かすのは 1 つまで
- **依存と重なり**: collect.sh が拾った依存に加え、同じファイル (`src/app/i18n/`、`src/app/routes/`、`src/server/db/schema.ts`) を
  両方が触ると見込むなら直列にする。並列にできるのは触る範囲が離れているものだけ

## 4. 起動

空きがあり (実行中 < N)、依存が完了していて、スキーマ変更の枠が空いている issue を 1 つ選ぶたびに:

1. `bash .claude/skills/issue-batch/scripts/state.sh <N> in-progress`
2. `.claude/skills/issue-batch/agent-prompt.md` の `{{N}}` `{{TITLE}}` `{{MAIN}}` を埋め、
   `Agent` を `subagent_type: general-purpose`、`isolation: worktree`、`name: issue-<N>` で起動する (`fork` は使わない)
3. plan.md を 実行中 にする

Agent の worktree は `.claude/worktrees/agent-<id>/`、ブランチは `worktree-agent-<id>`。パスは Agent の報告から取る。

## 5. 報告の処理

Agent の報告は先頭行の `状態:` で分ける。

- **MERGE_READY**: plan.md を マージ待ち にする。マージ中の issue が無ければ、その Agent に `SendMessage` で
  「`bash .claude/skills/issue-task/scripts/merge.sh` を実行して結果を報告」と送る (routes か e2e を触っていれば `--e2e`)。
  マージは常に 1 つずつ。同時に走らせると rebase 後に main が動いて fast-forward が失敗する
- **MERGED**: `bash .claude/skills/issue-batch/scripts/finish.sh <N> <worktree> <branch>`。
  main を push し、worktree とブランチを消し、issue を閉じる。plan.md を 完了 にし、次のマージ待ちへ進む
- **NEEDS_INPUT**: `state.sh <N> needs-input`。質問を `AskUserQuestion` で聞き、答えを issue にコメントし、
  `state.sh <N> in-progress` に戻して、同じ Agent に `SendMessage` で答えを送る
- **FAILED**: `bash .claude/skills/issue-batch/scripts/fail.sh <N> <worktree> "<理由>"`。worktree は残す。他の issue は続ける
- merge.sh が止まった報告 (コンフリクト、check 失敗) は Agent に解消させる。解消できなければ FAILED と同じ扱い

報告を処理するたびに、空きがあれば 4 に戻る。

## 6. 完了

全 issue が 完了 / 失敗 / 入力待ちのまま終了 のいずれかになったら、plan.md に結果をまとめて報告する。

- マージしたコミットと issue
- 失敗した issue と残した worktree のパス
- 聞いた質問と答え
