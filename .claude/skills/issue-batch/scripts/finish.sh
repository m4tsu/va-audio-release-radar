#!/usr/bin/env bash
# Agent がマージを終えた issue の後始末。main の作業ツリーで実行する。
# finish.sh <番号> <worktree のパス> <ブランチ>
# main を push し (Closes #N で issue が閉じる)、worktree とブランチを消し、ラベルを外す
set -euo pipefail
n=${1#\#}; wt=$2; branch=$3
here=$(dirname "${BASH_SOURCE[0]}")
main=$(git worktree list --porcelain | head -1 | sed 's/^worktree //')
cd "$main"

git merge-base --is-ancestor "$branch" main 2>/dev/null \
  || { echo "finish.sh: $branch は main に入っていない。マージが終わっていない" >&2; exit 1; }

git push origin main
echo "origin/main を更新した: $(git log -1 --format=%h)"

if [ -d "$wt" ]; then
  git worktree unlock "$wt" 2>/dev/null || true
  git worktree remove --force "$wt"
  echo "worktree を消した: $wt"
fi
git branch -D "$branch" >/dev/null 2>&1 && echo "ブランチを消した: $branch" || true

bash "$here/state.sh" "$n" done
if [ "$(gh issue view "$n" --json state -q .state)" = "OPEN" ]; then
  gh issue close "$n" --comment "main にマージ済み: $(git log -1 --format=%h)" >/dev/null
  echo "#$n を閉じた"
fi
