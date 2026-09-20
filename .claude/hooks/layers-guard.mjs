#!/usr/bin/env node
/**
 * 画面の層 (ルート / ページ / 部品) の分担が崩れたことを、その場で知らせる hook。
 * 2 つの入口から呼ばれる。
 *
 *   1. PostToolUse / Edit|Write  … src/app/{routes,pages,components}/ を編集した直後
 *   2. Stop                      … ターンを終える前
 *
 * `npm run check` が同じ検査 (scripts/check-app-layers.mjs) を持っているので、
 * この hook が無くてもマージはできない。編集した直後に気づけるようにするためだけに置く。
 *
 * 設計上の約束は migrations-guard.mjs と同じ:
 * - PostToolUse は編集をブロックしない。Stop はターン終了をブロックするが、
 *   `stop_hook_active` が true の回は必ず通す (無限ループを作らない)
 * - 検査スクリプトが無い / 起動できない、はすべて成功扱い。hook の不調で作業を止めない
 * - jq に依存しない。hook の入力 JSON は stdin から node が読む
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/** 編集されたとき検査を走らせるパス (プロジェクトルートからの相対) */
const WATCHED_PATHS = [/^src\/app\/(routes|pages|components)\/.+\.tsx?$/];

const CHECKER = "scripts/check-app-layers.mjs";

/** 想定外はすべてここを通る。hook の不調で作業を止めない */
function pass() {
  process.exit(0);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

let payload;
try {
  payload = JSON.parse(await readStdin());
} catch {
  pass();
}

const event = payload?.hook_event_name ?? (payload?.tool_name ? "PostToolUse" : "");

function shouldCheck() {
  if (event === "Stop") {
    // 本体が立てるループ防止フラグ。2 回目以降は通す
    return payload?.stop_hook_active !== true;
  }
  if (event !== "PostToolUse") return false;

  const filePath = payload?.tool_input?.file_path ?? payload?.tool_response?.filePath ?? "";
  if (typeof filePath !== "string" || filePath === "") return false;
  // 絶対パスでも相対パスでも来うるので、プロジェクトルートからの相対に揃える
  const relative = path
    .relative(projectDir, path.resolve(projectDir, filePath))
    .split(path.sep)
    .join("/");
  if (relative.startsWith("..")) return false;
  return WATCHED_PATHS.some((re) => re.test(relative));
}

if (!shouldCheck()) pass();

const checkerPath = path.join(projectDir, CHECKER);
if (!existsSync(checkerPath)) pass();

const result = spawnSync(process.execPath, ["--no-warnings", checkerPath], {
  cwd: projectDir,
  encoding: "utf8",
  timeout: 30_000,
});

// 検査そのものが起動できなかった場合は通す
if (result.error || typeof result.status !== "number") pass();
if (result.status === 0) pass();
// 「違反を見つけた」と「検査が壊れた」はどちらも 1 になりうる。検査スクリプトは
// 判定結果を必ず stdout に出してから終了するので、stdout が空なら不調とみなして通す
if (result.stdout.trim() === "") pass();

process.stderr.write(
  [
    "画面の層の分担が崩れている。ルートは loader と head だけを持ち、画面は src/app/pages/ に置く。",
    "ページと部品にはテストを隣に置く (.claude/rules/frontend.md)。",
    "ここが崩れると、画面の振る舞いを確かめる手段が dev サーバーを起こす E2E だけになる。",
    `\n${CHECKER} の出力:\n${result.stdout.trim()}`,
  ].join("\n") + "\n",
);
process.exit(2);
