#!/usr/bin/env bash
# ブランチを main に fast-forward で取り込む。worktree の中で実行する。
# コンフリクトの解消は必ずこの worktree (ブランチ側) で行い、main の作業ツリーでは何も解消しない。
# E2E を走らせるかは差分から決める (scripts/needs-e2e.sh)。呼び出し側は指定しない
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

root=$(git rev-parse --show-toplevel)
main=$(main_root)
[ "$root" != "$main" ] || die "main の作業ツリーでは実行しない"
cd "$root"
branch=$(git branch --show-current)
[ -n "$branch" ] && [ "$branch" != main ] || die "ブランチが main か detached: '$branch'"
[ -z "$(git status --porcelain)" ] || die "未コミットの変更がある。コミットしてから再実行する"
[ ! -d "$(git rev-parse --git-path rebase-merge)" ] && [ ! -d "$(git rev-parse --git-path rebase-apply)" ] \
  || die "rebase が途中。解消して git rebase --continue してから再実行する"

# 1. main を取り込む。コンフリクトはここで止まる
if ! git rebase main; then
  echo "issue-task: rebase でコンフリクト。この worktree で解消し、git rebase --continue のあと merge.sh を再実行する" >&2
  exit 1
fi

# 2. main の作業ツリーの未コミット変更と、このブランチが変えるファイルが重なっていないこと。
#    重なると git merge が拒否する (安全側) ので、先に検出して依頼内容を出す
changed=$(git diff --name-only main..HEAD)
dirty=$(git -C "$main" status --porcelain --untracked-files=all | awk '{print $NF}')
overlap=$(comm -12 <(echo "$changed" | sort) <(echo "$dirty" | sort))
if [ -n "$overlap" ]; then
  echo "issue-task: main の作業ツリーの未コミット変更と重なるファイルがある。main 側をコミットか stash してから再実行する:" >&2
  echo "$overlap" | sed 's/^/  - /' >&2
  exit 1
fi

# 3. rebase 後の状態で検査する。E2E を走らせるかは needs-e2e.sh が差分から決める
npm run check
if e2e_reason=$(bash scripts/needs-e2e.sh main); then
  echo "E2E を実行する (差分が E2E の範囲に触れている):"
  echo "$e2e_reason" | sed 's/^/  - /'
  # E2E 用ポート 5399 は 1 つしか無い。並行する worktree と取り合わないよう、
  # 共有の .git に置いたロックで順番に走らせる。listen しているかを見て判じると、
  # ポートが開くのは e2e:prepare (D1 の作り直し) のあとなので、同時に始めた
  # 2 つがどちらも「空いている」と見て両方走ってしまう
  exec 9>"$(git rev-parse --git-common-dir)/issue-task-e2e.lock"
  if ! flock -n 9; then
    echo "E2E 用ポート 5399 が空くのを待つ (別の worktree が E2E 中)"
    flock 9
  fi
  npm run test:e2e
  exec 9>&-
else
  echo "E2E は省略する (scripts/needs-e2e.sh の判定)"
fi

# 4. fast-forward だけで main を進める
before=$(git -C "$main" rev-parse main)
git -C "$main" merge --ff-only "$branch"
after=$(git -C "$main" rev-parse main)
echo "main: $before -> $after"

# 5. 新しいマイグレーションは main のローカル D1 にも当てる (.claude/rules/migrations.md)
if [ -n "$(git diff --name-only "$before..$after" -- 'migrations/*.sql')" ]; then
  if last=$(assert_no_recent_crawl "$main" 2>&1); then
    (cd "$main" && npm run db:migrate:local)
    echo "main のローカル D1 にマイグレーションを適用した"
  else
    echo "issue-task: $last" >&2
    echo "issue-task: main で npm run db:migrate:local を後で実行する必要がある" >&2
    exit 2
  fi
fi

echo "マージ完了。ExitWorktree (remove) で worktree を片付ける"
