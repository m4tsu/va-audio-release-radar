#!/usr/bin/env bash
# 一括実行の前提を確かめる。main の作業ツリーで実行する。
# issue-task の preflight に加えて、main が完全にクリーンであること (merge.sh が重なりで止まらないため) と
# gh が使えることを見る
set -euo pipefail
here=$(dirname "${BASH_SOURCE[0]}")
bash "$here/../../issue-task/scripts/preflight.sh"
if [ -n "$(git status --porcelain)" ]; then
  echo "issue-batch: main の作業ツリーに未コミットの変更がある。一括実行中は main を触らないので、先にコミットする:" >&2
  git status --porcelain | sed 's/^/  /' >&2
  exit 1
fi
gh auth status >/dev/null 2>&1 || { echo "issue-batch: gh が認証されていない" >&2; exit 1; }
echo "一括実行の前提: 問題なし"

bash "$(git rev-parse --show-toplevel)/scripts/kill-stale-workerd.sh"
