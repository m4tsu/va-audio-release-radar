// scripts/check-docs.mjs
//
// git 管理する文書とコードコメントが、書いた日の会話を前提にした語彙を含んでいないかを
// 機械的に検出する。規則そのものは .claude/rules/docs.md にある。
// 規則を文書に書くだけでは守られないので、`npm run check` の先頭で落とす。
//
// 検査するもの:
//   1. 禁止語彙 (タスク ID、節番号参照、会話の文脈を前提にした語)
//   2. docs/ 配下の各 .md の先頭にある 3 行ヘッダ (読者 / 更新 / 削除)
//   3. 行数上限 (docs/product.md、docs/architecture.md)

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** 検査対象のディレクトリとファイル (cwd からの相対) */
const ROOTS = ["docs", ".claude", "CLAUDE.md", "README.md", "src", "crawler", "scripts", "e2e", ".github"];

const EXTENSIONS = new Set([".md", ".ts", ".tsx", ".mjs", ".yml", ".yaml"]);

/** 検査から除くパス。禁止語彙そのものを列挙しているファイルと、生成物・外部の HTML */
const EXCLUDED = [
  "scripts/check-docs.mjs",
  "scripts/check-docs.test.ts",
  ".claude/rules/docs.md",
  "crawler/fixtures",
  "crawler/.cache",
  "src/app/routeTree.gen.ts",
  "node_modules",
];

/**
 * 禁止語彙。`T` + 数字は ISO 8601 の `T00:00:00` を除く (`:` が続くものは日時)。
 * `§` は、同じ行に文書名か「設計書 / 企画書」があるときだけ節番号参照とみなす
 * (`docs/stores/` が自分の中の節を §2 のように指すのは許す)
 */
export const FORBIDDEN_PATTERNS = [
  { re: /\bT\d{1,2}\b(?!:)/, label: "タスク ID" },
  { re: /(設計書|企画書|決定)\s*§/, label: "節番号での文書参照" },
  { re: /\.md[^\n§]{0,20}§/, label: "節番号での文書参照" },
  { re: /企画書/, label: "存在しない文書への参照" },
  {
    re: /ブレスト|ユーザー決定|ユーザー判断|ユーザーが行う|実装担当|サブエージェント|担当モデル|夜間|scratchpad|覆した|事故|教訓/,
    label: "会話の文脈を前提にした語",
  },
];

/** docs/ 配下の .md が先頭に持つべきヘッダ行 */
export const REQUIRED_HEADER_KEYS = ["読者:", "更新:", "削除:"];
const HEADER_SEARCH_LINES = 12;

/** 行数上限。境界と範囲だけを書く文書が膨らんでいないかを見る */
export const LINE_LIMITS = { "docs/product.md": 100, "docs/architecture.md": 150 };

function isExcluded(relative) {
  return EXCLUDED.some((prefix) => relative === prefix || relative.startsWith(`${prefix}/`));
}

function* walk(cwd, relative) {
  const absolute = path.join(cwd, relative);
  if (!existsSync(absolute) || isExcluded(relative)) return;
  const stat = statSync(absolute);
  if (stat.isFile()) {
    if (EXTENSIONS.has(path.extname(relative))) yield relative;
    return;
  }
  for (const name of readdirSync(absolute).sort()) {
    yield* walk(cwd, path.posix.join(relative, name));
  }
}

export function listTargets(cwd) {
  const files = [];
  for (const root of ROOTS) files.push(...walk(cwd, root));
  return files;
}

export function findForbidden(relative, text) {
  const findings = [];
  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    for (const { re, label } of FORBIDDEN_PATTERNS) {
      const match = re.exec(line);
      if (match) {
        findings.push({ file: relative, line: index + 1, label, excerpt: match[0] });
        break;
      }
    }
  }
  return findings;
}

export function findMissingHeader(relative, text) {
  if (!relative.startsWith("docs/") || path.extname(relative) !== ".md") return [];
  const head = text.split("\n").slice(0, HEADER_SEARCH_LINES);
  const missing = REQUIRED_HEADER_KEYS.filter((key) => !head.some((line) => line.startsWith(key)));
  if (missing.length === 0) return [];
  return [{ file: relative, line: 1, label: "先頭ヘッダが無い", excerpt: missing.join(" ") }];
}

export function findOverLimit(relative, text) {
  const limit = LINE_LIMITS[relative];
  if (limit === undefined) return [];
  const count = text.split("\n").length;
  if (count <= limit) return [];
  return [{ file: relative, line: count, label: "行数上限", excerpt: `${count} 行 > ${limit} 行` }];
}

export function run({ cwd = process.cwd() } = {}) {
  const findings = [];
  for (const relative of listTargets(cwd)) {
    const text = readFileSync(path.join(cwd, relative), "utf8");
    findings.push(
      ...findForbidden(relative, text),
      ...findMissingHeader(relative, text),
      ...findOverLimit(relative, text),
    );
  }
  if (findings.length === 0) {
    return { code: 0, findings, message: "文書とコメントの検査: 問題なし" };
  }
  const lines = findings.map((f) => `  ${f.file}:${f.line}  [${f.label}] ${f.excerpt}`);
  return {
    code: 1,
    findings,
    message: [
      `文書とコメントの検査: ${findings.length} 件`,
      ...lines,
      "",
      "規則は .claude/rules/docs.md にある。会話の文脈を前提にした語と節番号参照は書かない。",
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
