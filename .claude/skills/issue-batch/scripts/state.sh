#!/usr/bin/env bash
# issue のラベルを一括実行の状態に合わせる。state.sh <番号> <ready|in-progress|needs-input|failed|done>
# done はラベルを全部外す。閉じるのは push した Closes #N に任せ、開いたままなら finish.sh が閉じる
set -euo pipefail
n=${1#\#}; state=$2
all=(ready in-progress needs-input failed)
case "$state" in
  ready|in-progress|needs-input|failed|done) ;;
  *) echo "state.sh: 不明な状態 $state" >&2; exit 1 ;;
esac
# gh は同じラベルを --remove-label と --add-label の両方に渡すと削除を優先する。
# 目標のラベルは remove に含めない
remove=()
for l in "${all[@]}"; do [ "$l" != "$state" ] && remove+=("$l"); done
args=(--remove-label "$(IFS=,; echo "${remove[*]}")")
[ "$state" != done ] && args+=(--add-label "$state")
gh issue edit "$n" "${args[@]}" >/dev/null
echo "#$n -> $state"
