#!/usr/bin/env bash
# worktree に入った直後に実行する。git 管理外の資源 (node_modules / .dev.vars / ローカル D1) を
# main から複製し、dev サーバー用の空きポートを work/dev-port に書く
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

root=$(git rev-parse --show-toplevel)
main=$(main_root)
[ "$root" != "$main" ] || die "main の作業ツリーでは実行しない。worktree の中で実行する"
cd "$root"
mkdir -p work

# node_modules: lock が同じならハードリンクで複製する (ディスクをほぼ使わず数秒で終わる)。
# npm はファイルを置き換えて更新するので、複製側の npm install が main に影響することはない。
# tsc / vite が書き込むキャッシュだけは共有すると壊れるので複製後に消す
if [ -e node_modules ]; then
  echo "node_modules: 既にある"
elif cmp -s package-lock.json "$main/package-lock.json"; then
  cp -al "$main/node_modules" node_modules
  rm -rf node_modules/.tmp node_modules/.vite node_modules/.vite-temp node_modules/.cache
  echo "node_modules: main からハードリンクで複製した"
else
  echo "node_modules: package-lock.json が main と違うので npm ci を実行する"
  npm ci
fi

if [ -f "$main/.dev.vars" ] && [ ! -f .dev.vars ]; then
  cp "$main/.dev.vars" .dev.vars
  echo ".dev.vars: main から複製した"
fi

# ローカル D1: main の実データを複製して worktree 専用にする。以後 main の D1 には触らない
if [ -d "$D1_DIR" ]; then
  echo "D1: 既にある ($D1_DIR)"
elif [ -d "$main/$D1_DIR" ]; then
  assert_no_recent_crawl "$main"
  mkdir -p "$(dirname "$D1_DIR")"
  cp -r "$main/$D1_DIR" "$D1_DIR"
  echo "D1: main から複製した ($(du -sh "$D1_DIR" | cut -f1))"
else
  echo "D1: main に無いので複製しない。npm run db:migrate:local で空の D1 を作る"
fi

# dev サーバーのポート: 開発用 5199 と E2E 用 5399 を避け、他の worktree が確保した値とも重ねない
reserved=$(cat "$main"/.claude/worktrees/*/work/dev-port 2>/dev/null || true)
port=5200
while ss -ltn 2>/dev/null | grep -q ":$port " || echo "$reserved" | grep -qx "$port"; do
  port=$((port + 1))
done
echo "$port" > work/dev-port
echo "dev ポート: $port (work/dev-port)"

# 前の作業が残した vite / workerd を落とす。worktree が増えるほど溜まりやすい
bash "$main/scripts/kill-stale-workerd.sh"
