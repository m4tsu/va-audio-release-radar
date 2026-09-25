#!/usr/bin/env bash
# 対象 issue を集めて work/issue-batch/<run>/issues.json に書く。
# 引数に番号があればそれだけ、無ければ ready ラベルの open issue すべて。
# 1 行ずつの要約 (優先度・依存・スキーマ変更・触る場所) は scripts/issue-body.mjs の summarize が作る
set -euo pipefail
root=$(git rev-parse --show-toplevel)
run="$root/work/issue-batch/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$run"

if [ $# -gt 0 ]; then
  nums=("$@")
  json="["
  for n in "${nums[@]}"; do
    n=${n#\#}
    json+=$(gh issue view "$n" --json number,title,body,labels,state)","
  done
  json="${json%,}]"
else
  json=$(gh issue list --label ready --state open --limit 50 --json number,title,body,labels,state)
fi
printf '%s' "$json" > "$run/issues.json"

# 欄の読み方は task.yml を読む scripts/issue-body.mjs が持つ。見出しをここに写さない
node --no-warnings "$root/scripts/issue-body.mjs" summarize "$run/issues.json"
echo "RUN_DIR=$run"
