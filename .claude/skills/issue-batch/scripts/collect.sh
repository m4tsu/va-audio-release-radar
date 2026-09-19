#!/usr/bin/env bash
# 対象 issue を集めて work/issue-batch/<run>/issues.json に書く。
# 引数に番号があればそれだけ、無ければ ready ラベルの open issue すべて。
# 本文の「depends on #N」「blocked by #N」「#N に依存」を依存として拾う
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

node --no-warnings -e '
  const issues = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  if (issues.length === 0) { console.log("対象 issue: なし"); process.exit(0); }
  const depRe = /(?:depends on|blocked by|依存)[^\n]*?#(\d+)|#(\d+)\s*に依存/gi;
  for (const i of issues) {
    const deps = new Set();
    for (const m of (i.body ?? "").matchAll(depRe)) deps.add(m[1] ?? m[2]);
    const labels = i.labels.map((l) => l.name).join(",");
    console.log(`#${i.number}\t${i.title}\tlabels=${labels}\tdeps=${[...deps].map((d) => "#" + d).join(",") || "-"}`);
  }
' "$run/issues.json"
echo "RUN_DIR=$run"
