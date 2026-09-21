#!/usr/bin/env bash
# 親を失った vite dev と workerd を落とす。
#
# 残り方が 2 通りある。
#
# - vite が SIGKILL された (OOM killer など)。vite は子を畳めず、workerd だけが残る
# - `npx vite dev` を止めた。SIGTERM が npx のラッパー止まりで `node vite` に届かず、
#   vite と workerd が丸ごと残る (ラッパーを外す対策は SKILL.md と playwright.config.ts 側)
#
# どちらも親を失って里親に引き取られる。里親は WSL では各セッションの Relay、そうでなければ PID 1。
# 生きているものの親は sh か npm か bash なので、里親に付いているかどうかで見分ける。
# workerd は 1 プロセス 200〜500 MB を保持したまま居座るので放っておくとメモリを食い潰す。
#
# 対象はこのリポジトリ (worktree を含む) の node_modules から起動されたものだけ。
#
# プロセス名では引けない。node は自分の comm を MainThread に書き換えるので `pgrep -x node` に
# 出てこない。cmdline で引く
set -euo pipefail

# worktree から呼んでも main の作業ツリーを指す。worktree 側の実体も .claude/worktrees/ 以下にあるので
# これ 1 本で覆える
scope=$(dirname "$(realpath "$(git rev-parse --git-common-dir)")")

# 親が里親なら孤児。Relay(NNNN) は WSL のセッション init、PID 1 は通常の init
is_orphan() {
  local ppid="$1" parent
  [ "$ppid" = 1 ] && return 0
  parent=$(cat "/proc/$ppid/comm" 2>/dev/null) || return 0
  case "$parent" in Relay\(*\)) return 0 ;; *) return 1 ;; esac
}

# このリポジトリ配下の、$1 に当てはまる孤児の pid を出す
orphans_matching() {
  local needle="$1" pid args
  for pid in $(ls -1 /proc | grep -E '^[0-9]+$'); do
    # 走査中に消えるプロセスがあるので、開けないものは黙って飛ばす
    args=$(cat "/proc/$pid/cmdline" 2>/dev/null | tr '\0' ' ')
    [ -n "$args" ] || continue
    case "$args" in *"$scope"/*"$needle"*) ;; *) continue ;; esac
    is_orphan "$(awk '{print $4}' "/proc/$pid/stat" 2>/dev/null || echo 1)" || continue
    echo "$pid"
  done
}

rss_mb() {
  awk '/^VmRSS:/ {print int($2 / 1024)}' "/proc/$1/status" 2>/dev/null || echo 0
}

killed=0

# 1. 孤児の vite。SIGTERM を受ければ自分で workerd を畳むので、先にこちらを始末する
for pid in $(orphans_matching "/vite "); do
  kill -TERM "$pid" 2>/dev/null || continue
  echo "孤児の vite を落とした: pid=$pid $(rss_mb "$pid") MB"
  killed=$((killed + 1))
done

# vite が workerd を畳むのを待つ
[ "$killed" -gt 0 ] && sleep 3

# 2. 親を失ったまま残っている workerd。SIGTERM を無視するので最初から SIGKILL
for pid in $(orphans_matching "/workerd "); do
  mb=$(rss_mb "$pid")
  kill -KILL "$pid" 2>/dev/null || continue
  echo "孤児の workerd を落とした: pid=$pid ${mb} MB"
  killed=$((killed + 1))
done

[ "$killed" -eq 0 ] && echo "孤児の vite / workerd: なし"
exit 0
