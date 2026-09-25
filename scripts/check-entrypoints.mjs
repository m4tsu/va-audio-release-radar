// scripts/check-entrypoints.mjs
//
// 直接実行するファイルが、どこから実行されるかを持っているかを検査する。
// 一度きりの調査や修復のために書いたスクリプトは、使い終わっても「いつかまた使うかもしれない」で残り、
// 何のために・いつ流すものかを誰も言えないまま増えていく。実行する経路
// (`package.json` の scripts、`.github/` のワークフロー、`.claude/` の設定・hook・スキル) のどこにも
// 名前が無いものは、再利用の条件が無いとみなして落とす。
// 残すなら `package.json` に名前を付けて載せる (README の「コマンド」への記載は `check:docs` が求める)。
// 使い捨てなら `work/` に置く (.claude/rules/docs.md の「`work/` の寿命」)。
//
// 直接実行するファイルとみなすもの:
//   - scripts/ の .mjs と .sh (他のファイルから import されている .mjs は部品なので除く)
//   - scripts/・crawler/・e2e/ の中で、自分が直接起動されたかを判定しているファイル

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** 直接実行するファイルを探すディレクトリ */
const ENTRY_ROOTS = ["scripts", "crawler", "e2e"];
const ENTRY_EXTENSIONS = new Set([".mjs", ".ts", ".sh"]);

/**
 * 実行する経路。ここに相対パスが書かれていれば、実行の仕方が決まっているとみなす。
 * `.claude/rules/` のような規則の文書は名前に触れるだけで実行しないので含めない
 */
const RUNNER_ROOTS = [
  "package.json",
  ".github",
  ".claude/settings.json",
  ".claude/hooks",
  ".claude/skills",
];
const RUNNER_EXTENSIONS = new Set([".json", ".yml", ".yaml", ".sh", ".mjs", ".md"]);

/** import されているかを探す範囲 */
const IMPORT_ROOTS = ["scripts", "crawler", "e2e", "src", ".claude"];

const SKIPPED = [
  "node_modules",
  "crawler/fixtures",
  "crawler/.cache",
  ".claude/worktrees",
  "src/app/routeTree.gen.ts",
];

/** `if (isMainModule())` や `import.meta.url === pathToFileURL(process.argv[1]).href` の形 */
const MAIN_GUARD = /pathToFileURL\(process\.argv\[1\]|isMainModule\(\)/;

function isSkipped(relative) {
  return SKIPPED.some((prefix) => relative === prefix || relative.startsWith(`${prefix}/`));
}

function* walk(cwd, relative, extensions) {
  const absolute = path.join(cwd, relative);
  if (!existsSync(absolute) || isSkipped(relative)) return;
  if (statSync(absolute).isFile()) {
    if (extensions.has(path.extname(relative))) yield relative;
    return;
  }
  for (const name of readdirSync(absolute).sort()) {
    yield* walk(cwd, path.posix.join(relative, name), extensions);
  }
}

function isTest(relative) {
  return /\.test\.[cm]?[jt]sx?$/.test(relative);
}

function isImported(cwd, relative) {
  const name = path.posix.basename(relative);
  const importPattern = new RegExp(`from ["'][^"']*/${name.replaceAll(".", "\\.")}["']`);
  for (const root of IMPORT_ROOTS) {
    for (const file of walk(cwd, root, new Set([".ts", ".tsx", ".mjs"]))) {
      if (file === relative) continue;
      if (importPattern.test(readFileSync(path.join(cwd, file), "utf8"))) return true;
    }
  }
  return false;
}

export function listEntrypoints(cwd) {
  const entries = [];
  for (const root of ENTRY_ROOTS) {
    for (const relative of walk(cwd, root, ENTRY_EXTENSIONS)) {
      if (isTest(relative)) continue;
      const text = readFileSync(path.join(cwd, relative), "utf8");
      const guarded = MAIN_GUARD.test(text);
      const topLevelScript =
        relative.startsWith("scripts/") &&
        (relative.endsWith(".sh") || (relative.endsWith(".mjs") && !isImported(cwd, relative)));
      if (guarded || topLevelScript) entries.push(relative);
    }
  }
  return entries;
}

function runnerTexts(cwd) {
  const texts = [];
  for (const root of RUNNER_ROOTS) {
    for (const relative of walk(cwd, root, RUNNER_EXTENSIONS)) {
      texts.push(readFileSync(path.join(cwd, relative), "utf8"));
    }
  }
  return texts;
}

export function findUnreferenced(entries, texts) {
  return entries.filter((entry) => !texts.some((text) => text.includes(entry)));
}

export function run({ cwd = process.cwd() } = {}) {
  const unreferenced = findUnreferenced(listEntrypoints(cwd), runnerTexts(cwd));
  if (unreferenced.length === 0) {
    return { code: 0, unreferenced, message: "実行ファイルの検査: 問題なし" };
  }
  return {
    code: 1,
    unreferenced,
    message: [
      `実行ファイルの検査: ${unreferenced.length} 件`,
      ...unreferenced.map((file) => `  ${file}`),
      "",
      "package.json・.github/・.claude/ のどこからも実行されていない。",
      "残すなら package.json の scripts に名前を付けて載せ、README の「コマンド」にいつ流すかを書く。",
      "一度きりのものは消すか work/ に置く。",
    ].join("\n"),
  };
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  const result = run();
  console.log(result.message);
  process.exit(result.code);
}
