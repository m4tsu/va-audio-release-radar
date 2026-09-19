#!/usr/bin/env bash
# issue を作る。create.sh <タイトル> <本文ファイル> <p1|p2|p3> [ready]
# 本文は .github/ISSUE_TEMPLATE/task.yml と同じ見出し (### 目的 ...) で書く。
# 出力の最後の行が issue の URL。番号は basename で取れる
set -euo pipefail
title=$1; body=$2; priority=$3; ready=${4:-}
case "$priority" in p1|p2|p3) ;; *) echo "create.sh: 優先度は p1|p2|p3: $priority" >&2; exit 1 ;; esac
[ -f "$body" ] || { echo "create.sh: 本文ファイルが無い: $body" >&2; exit 1; }
for h in "### 目的" "### 受け入れ条件"; do
  grep -q "^$h" "$body" || { echo "create.sh: 本文に「$h」が無い" >&2; exit 1; }
done
labels="$priority"
[ "$ready" = ready ] && labels="$labels,ready"
gh issue create --title "$title" --body-file "$body" --label "$labels"
