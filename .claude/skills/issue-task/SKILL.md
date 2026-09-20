---
name: issue-task
description: issue から worktree を切り、要件確認・実装・別エージェントによるレビュー・main への fast-forward マージまでを一続きで行う
argument-hint: "<issue 番号 | 要件の文章>"
disable-model-invocation: true
---

# issue-task

引数は GitHub issue の番号 (`12` / `#12`) か、要件の文章。
スクリプトは `.claude/skills/issue-task/scripts/`。失敗時は理由を出して 0 以外で終わる。
0 以外で終わったら次へ進まず、出力の指示に従う。解消できない場合はそこで止めて報告する。

## 1. 前提の確認 (main の作業ツリーで)

```
bash .claude/skills/issue-task/scripts/preflight.sh
```

main ブランチにいること、origin/main に遅れていないこと (遅れていれば fast-forward で追従する)、
スキーマ変更中の他 worktree ブランチの有無を確かめる。

issue 番号なら `gh issue view <N> --json number,title,body` で本文を取る。

## 2. worktree

`EnterWorktree` を `name: issue-<N>-<slug>` (文章なら `<slug>`) で呼ぶ。
`.claude/settings.json` の `worktree.baseRef` が `head` なので、main の HEAD から切られる。入ったら:

```
bash .claude/skills/issue-task/scripts/setup.sh
```

node_modules (lock が同じならハードリンク複製、違えば `npm ci`)、`.dev.vars`、ローカル D1 を main から複製し、
dev サーバー用の空きポートを `work/dev-port` に書く。以後 main の `.wrangler/state` には触らない。

issue 本文 (または引数の文章) を `work/task.md` に保存する。

## 3. 要件

`work/task.md` を `docs/product.md` と `docs/architecture.md` に照らす。次のどれかに当てはまるときだけ
`AskUserQuestion` で聞き、答えを `work/task.md` に追記する。

- 読み方が複数あり、どれを取るかで作るものが変わる
- `docs/product.md` の「作らない」に触れる
- 外部サイトへの新しいアクセスが要る (`docs/stores/` に記述が無い)

当てはまらなければ聞かずに進む。

## 4. 設計と実装

- 触るパスの規則 (`.claude/rules/`) に従う
- 画面を足す / 変えるときは `src/app/pages/` に置き、テストを隣に置く。
  ルートは loader と head だけを持つ (`.claude/rules/frontend.md`)
- スキーマを変えるなら、preflight が出した「スキーマ変更中の worktree ブランチ」が「なし」であること。
  あれば止めて報告する (`migrations/` の連番と `meta/_journal.json` が両立しない)
- 動作確認の dev サーバーは `npx vite dev --port $(cat work/dev-port) --strictPort`。終わったら止める
- 区切りごとにコミットする。issue 番号があれば最後のコミット本文に `Closes #<N>` を入れる

## 5. 検査

```
npm run check
```

E2E はここでは実行しない。7 の `merge.sh` が差分を見て必要なときだけ走らせる。

## 6. レビュー (会話文脈を持たない別エージェント)

`.claude/skills/issue-task/review-prompt.md` の `{{BRANCH}}` と `{{ROOT}}` を埋め、
`Agent` (subagent_type: `general-purpose`。`fork` は会話文脈を引き継ぐので使わない) に渡す。
報告をそのまま `work/review-<n>.md` に保存する。

- `FIX_REQUIRED` なら must を直し、5 から繰り返す。3 回で `MERGE_OK` にならなければ止めて、残った指摘を報告する
- should は直すか、直さない理由を `work/task.md` に書く

## 7. マージ

```
bash .claude/skills/issue-task/scripts/merge.sh
```

- main を rebase する。コンフリクトはこの worktree で解消し、`git rebase --continue` してから再実行する
- rebase 後に `npm run check` を再実行する。E2E は差分が E2E の範囲に触れていれば自動で走る
  (`scripts/needs-e2e.sh`。ポート 5399 は E2E 専用で固定。他の worktree が使っていれば空くまで待つ)
- main の作業ツリーの未コミット変更と、このブランチの変更ファイルが重なれば止まる。
  main 側のコミットか stash をユーザーに依頼する
- `git merge --ff-only` で main を進める。新しいマイグレーションは main のローカル D1 にも当てる

成功したら `ExitWorktree` を `action: remove` で呼ぶ。

## 8. 報告

- マージしたコミット、変えた範囲、レビューで直した点、直さなかった should とその理由
- 残った依頼 (main 側の未コミット変更、`npm run db:migrate:remote` など)

## 一括実行のとき (issue-batch から起動された場合)

司令塔の Agent として worktree の中で起動されたときは、次の点だけ上と変える。起動時の指示は
`.claude/skills/issue-batch/agent-prompt.md`。

- 1 と 2 の `preflight.sh` と `EnterWorktree` は飛ばす。worktree は既にある。`setup.sh` から始める
- issue の本文とコメントを `gh issue view <N> --comments` で読んで `work/task.md` に保存する
- 3 で `AskUserQuestion` を使わない。質問を書いて状態 `NEEDS_INPUT` で終える。答えは追加の指示で届く
- 6 が通ったら `merge.sh` を実行せず、状態 `MERGE_READY` で終える。マージは追加の指示で頼まれてから実行し、
  結果を状態 `MERGED` で報告する
- `ExitWorktree` を呼ばない。後始末は司令塔が行う
- レビュー 3 回で通らない、コンフリクトを解消できない、のときは状態 `FAILED` で終える
