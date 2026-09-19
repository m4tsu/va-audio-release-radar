#!/usr/bin/env bash
# worktree を切る前に main の状態を確かめる。main の作業ツリーで実行する
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

root=$(git rev-parse --show-toplevel)
[ "$root" = "$(main_root)" ] || die "main の作業ツリーで実行する: $(main_root)"
branch=$(git branch --show-current)
[ "$branch" = main ] || die "main ブランチではない: $branch"

if git fetch -q origin main 2>/dev/null; then
  behind=$(git rev-list --count main..origin/main)
  ahead=$(git rev-list --count origin/main..main)
  if [ "$behind" -gt 0 ]; then
    [ "$ahead" -eq 0 ] || die "main と origin/main が分岐している (ahead $ahead / behind $behind)。手で解消してから再実行する"
    git merge --ff-only origin/main >/dev/null \
      || die "origin/main の取り込みが未コミット変更と重なる。main 側をコミットか stash してから再実行する"
    echo "origin/main を取り込んだ ($behind コミット)"
  fi
else
  echo "origin に届かない。ローカルの main をそのまま使う"
fi

echo "main: $(git log -1 --format='%h %s')"
echo "main の未コミット変更: $(git status --porcelain | wc -l) ファイル"

locks=$(schema_changing_branches)
if [ -n "$locks" ]; then
  echo "スキーマ変更中の worktree ブランチ (同時に 1 つまで):"
  echo "$locks" | sed 's/^/  - /'
else
  echo "スキーマ変更中の worktree ブランチ: なし"
fi
