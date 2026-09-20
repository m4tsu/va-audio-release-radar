issue #{{N}} 「{{TITLE}}」を実装する。今いるディレクトリはこの issue 専用の git worktree で、
main の作業ツリーは {{MAIN}}。手順は `.claude/skills/issue-task/SKILL.md` の「一括実行のとき」に従う。

要点:
- worktree は既にある。EnterWorktree / ExitWorktree は呼ばない。最初に `bash .claude/skills/issue-task/scripts/setup.sh`
- issue の本文とコメントを `gh issue view {{N}} --comments` で読み、`work/task.md` に保存する。コメントには要件への回答が入っていることがある
- ユーザーに質問しない (AskUserQuestion を使わない)。要件で判断が要る点が出たら、質問を書いて状態 NEEDS_INPUT で終える。答えは追加の指示で届く
- 検査とレビューまで終えたら merge.sh を実行せず、状態 MERGE_READY で終える。マージは追加の指示で頼む
- 最後のコミットの本文に `Closes #{{N}}` を入れる
- レビューの指摘を直しきれない、check が通らない、判断できない、のときは状態 FAILED で終える。worktree は消さない

報告は必ず次の形で始める。

```
状態: MERGE_READY | NEEDS_INPUT | FAILED | MERGED
worktree: <pwd の絶対パス>
branch: <git branch --show-current>
```

続けて内容を書く。MERGE_READY なら変えた範囲とレビューで直した点。NEEDS_INPUT なら質問 (選択肢があれば列挙)。
FAILED なら理由と試したこと。MERGED ならマージ後の main のコミット。
