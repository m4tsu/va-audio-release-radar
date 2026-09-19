#!/usr/bin/env bash
# issue-task の各スクリプトが共有する関数。単体では実行しない

die() {
  echo "issue-task: $*" >&2
  exit 1
}

# main の作業ツリー (git worktree list の先頭)
main_root() {
  git worktree list --porcelain | head -1 | sed 's/^worktree //'
}

# miniflare が D1 を書き出すディレクトリ (repo root からの相対)
D1_DIR=".wrangler/state/v3/d1"
D1_OBJECT_DIR="$D1_DIR/miniflare-D1DatabaseObject"

# ローカル D1 の crawl_runs.started_at の最大値を出す。無ければ空文字。
# 読み取り専用で開くのでクロール中でも安全 (scripts/check-migrations.mjs と同じ方法)
last_crawl_started() {
  local dir="$1/$D1_OBJECT_DIR"
  [ -d "$dir" ] || return 0
  node --no-warnings -e '
    const { DatabaseSync } = require("node:sqlite");
    const fs = require("node:fs");
    const dir = process.argv[1];
    const files = fs.readdirSync(dir).filter((n) => n.endsWith(".sqlite") && n !== "metadata.sqlite");
    if (files.length === 0) process.exit(0);
    const db = new DatabaseSync(`${dir}/${files[0]}`, { readOnly: true });
    try {
      const row = db.prepare("select max(started_at) as m from crawl_runs").get();
      if (row?.m) process.stdout.write(String(row.m));
    } catch {
      // crawl_runs が無い = まだ何も取り込んでいない
    } finally {
      db.close();
    }
  ' "$dir"
}

# 直近のクロールが n 分以内なら 0 以外で終わる。CLAUDE.md「ローカルの共有資源」の判定と同じ
assert_no_recent_crawl() {
  local root="$1" minutes="${2:-10}"
  local last
  last=$(last_crawl_started "$root")
  [ -n "$last" ] || return 0
  local last_epoch now_epoch
  last_epoch=$(date -d "$last" +%s 2>/dev/null || echo 0)
  now_epoch=$(date +%s)
  if [ $((now_epoch - last_epoch)) -lt $((minutes * 60)) ]; then
    die "ローカル D1 に $last のクロール記録がある。別プロセスが書き込み中の可能性が高い。終わってから再実行する"
  fi
}

# main 以外の worktree ブランチのうち、スキーマを変えているものを列挙する
schema_changing_branches() {
  git worktree list --porcelain | awk '/^branch /{sub("refs/heads/", "", $2); print $2}' | while read -r b; do
    [ "$b" = main ] && continue
    if [ -n "$(git diff --name-only "main...$b" -- migrations src/server/db/schema.ts 2>/dev/null)" ]; then
      echo "$b"
    fi
  done
}
