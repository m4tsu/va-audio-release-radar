#!/usr/bin/env bash
# main からの差分に E2E が守っている範囲が含まれるかを判定する。
# 含まれれば 0、含まれなければ 1 を返し、当たったパスを stdout に出す。
#
# E2E が見るのは SSR の応答・ハイドレーション・ブラウザ保存・cookie の 4 つだけ
# (.claude/rules/frontend.md)。どれも dev サーバーと D1 が要るので、
# src/app/pages/ と src/app/components/ だけの変更では走らせる意味が無い。
#
# 判定を人に任せると「触ったかどうか」の記憶に頼ることになるので、差分から機械的に決める。
set -euo pipefail

base="${1:-main}"

# E2E が守っている範囲。ここに当たらない変更では E2E を走らせない
patterns=(
  'src/app/routes/'      # loader / head / server handlers。SSR の応答そのもの
  'src/app/server-fns/'  # ルートと画面がサーバーを呼ぶ境界
  'src/server/'          # 応答の中身を作る側
  'src/app/store/'       # IndexedDB のフォロー。jsdom には IndexedDB が無く E2E でしか通らない
  'src/router.tsx'       # ルーターの組み立て
  'migrations/'          # 固定データを流す先のスキーマ
  'e2e/'
  'playwright.config.ts'
  'vite.config.ts'       # dev サーバーと persistState の配線
  'package.json'         # 依存とスクリプト
)

changed=$(git diff --name-only "$base...HEAD")

matched=""
for pattern in "${patterns[@]}"; do
  hit=$(printf '%s\n' "$changed" | { grep -F "$pattern" || true; })
  [ -n "$hit" ] && matched="${matched}${hit}"$'\n'
done

if [ -z "$matched" ]; then
  exit 1
fi

printf '%s' "$matched" | sort -u
