#!/usr/bin/env bash
# 自動で完了できなかった issue に failed ラベルを付け、理由と残した worktree を issue に書く。
# fail.sh <番号> <worktree のパス | -> <理由>
set -euo pipefail
n=${1#\#}; wt=$2; reason=$3
here=$(dirname "${BASH_SOURCE[0]}")
bash "$here/state.sh" "$n" failed
body="一括実行で自動では完了できなかった。

理由: $reason"
[ "$wt" != "-" ] && body+="

作業途中の worktree: \`$wt\` (ブランチ \`$(git -C "$wt" branch --show-current 2>/dev/null || echo '?')\`)"
gh issue comment "$n" --body "$body" >/dev/null
echo "#$n に理由を書いた"
