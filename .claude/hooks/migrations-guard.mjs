#!/usr/bin/env node
/**
 * マイグレーションの適用漏れを捕まえる hook。3 つの入口から呼ばれる。
 *
 *   1. Stop                      … ターンを終える前に必ず検査する (本命)
 *   2. PostToolUse / Edit|Write  … migrations/*.sql か schema.ts を編集した直後
 *   3. PostToolUse / Bash        … db:generate / drizzle-kit generate を実行した直後
 *
 * なぜ Stop が本命か: `npm run db:generate` は drizzle-kit が migrations/*.sql を
 * 直接書き出すので Edit / Write ツールを通らない。ファイルがどう作られたかに関係なく
 * 捕まえられるのは Stop だけ。2 回の事故 (docs/design/decisions.md §14) はこの経路だった。
 *
 * 設計上の約束:
 * - 編集やコマンド実行はブロックしない。PostToolUse は「実行後に促す」だけ
 * - Stop はターン終了をブロックする。ただし `stop_hook_active` が true の回は必ず通す。
 *   Claude Code 本体が「Stop フックでは stop_hook_active を見て true の間は成功を返せ」
 *   と案内しているため。無限ループを作らない
 * - ローカル D1 が無い / 検査スクリプトが無い / 検査が起動できない、はすべて成功扱い。
 *   hook の不調でターンが終われなくなる事故を作らない
 * - jq に依存しない。hook の入力 JSON は stdin から node が読む
 *
 * 実体の検査は scripts/check-migrations.mjs (T17) が行う。
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/** 編集されたとき検査を走らせるパス (プロジェクトルートからの相対) */
const WATCHED_PATHS = [/^migrations\/[^/]+\.sql$/, /^src\/server\/db\/schema\.ts$/];

/** 実行されたとき検査を走らせるコマンド。drizzle-kit がファイルを直接書き出す経路 */
const WATCHED_COMMANDS = [/\bdb:generate\b/, /drizzle-kit\s+(\S+\s+)*generate\b/];

const CHECKER = "scripts/check-migrations.mjs";

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

/** この呼び出しで検査を走らせるべきかを決める */
function shouldCheck() {
  if (event === "Stop") {
    // 本体が立てるループ防止フラグ。2 回目以降は通す
    return payload?.stop_hook_active !== true;
  }
  if (event !== "PostToolUse") return false;

  if (payload?.tool_name === "Bash") {
    const command = payload?.tool_input?.command;
    return typeof command === "string" && WATCHED_COMMANDS.some((re) => re.test(command));
  }

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
  timeout: 45_000,
});

// 検査そのものが起動できなかった場合は通す
if (result.error || typeof result.status !== "number") pass();
// ローカル D1 が無い場合も検査スクリプトが 0 を返す
if (result.status === 0) pass();

// ここから先は終了コードが非 0。ただし「未適用を見つけた」と「検査が壊れた」は
// どちらも 1 になりうる (未捕捉の例外でも node は 1 で終わる)。
// 検査スクリプトは判定結果を必ず stdout に出してから終了するので、
// stdout が空なら検査の不調とみなして通す。止めるべきでないときに止めないため
if (result.stdout.trim() === "") pass();

const headline =
  event === "Stop"
    ? "マイグレーションが未適用のままターンを終えようとしている。`npx wrangler d1 migrations apply DB --local` を実行すること。"
    : "未適用のマイグレーションがある。`npx wrangler d1 migrations apply DB --local` を実行すること。";

const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();

process.stderr.write(
  [
    headline,
    "適用しないとコードと DB が食い違い、画面が落ちる。実行中のクロールがあれば静かに壊れる",
    "(docs/design/decisions.md §14)。",
    detail ? `\n${CHECKER} の出力:\n${detail}` : "",
  ]
    .filter(Boolean)
    .join("\n") + "\n",
);
process.exit(2);
