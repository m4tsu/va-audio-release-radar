// scripts/check-app-layers.mjs
//
// 画面の層 (ルート / ページ / 部品) の分担が守られているかを機械的に検査する。
// 規則そのものは .claude/rules/frontend.md にある。
// 規則を文書に書くだけでは守られないので、`npm run check` で落とす。
//
// 検査するもの:
//   1. ルートが画面を描いていない (HTML 要素の JSX を持たない)
//   2. ルートが画面の状態や表示言語のフックを持たない
//   3. ページに隣り合うテストがある
//   4. 状態を持つ部品に隣り合うテストがある
//
// なぜこれを落とすか: ルートに画面が直書きされていると、画面の振る舞いを確かめる手段が
// dev サーバーを起こす E2E しか無くなる。ページと部品に切り出してあれば jsdom で確かめられ、
// E2E は SSR の応答・ハイドレーション・ブラウザ保存・cookie だけに絞れる。

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROUTES_DIR = "src/app/routes";
const PAGES_DIR = "src/app/pages";
const COMPONENTS_DIR = "src/app/components";

/**
 * ルートのうち、HTML 要素の JSX を持ってよいファイル。
 * `__root.tsx` は `<html>` から `<body>` までの文書そのものを組み立てる
 */
const DOCUMENT_ROUTES = new Set([`${ROUTES_DIR}/__root.tsx`]);

/** ルートに書いてはいけない import。画面の状態と表示言語は画面の持ち物 */
export const FORBIDDEN_ROUTE_HOOKS = [
  "useState",
  "useEffect",
  "useRef",
  "useMemo",
  "useCallback",
  "useReducer",
  "useId",
  // `createTranslator` は head() に要るので許す。フックとして呼ぶ 2 つだけを止める
  "useT",
  "useLocale",
];

/**
 * 部品にテストを義務づける条件。状態か保存を持つ部品は、描いただけでは振る舞いが決まらない。
 * 受け取った props を並べるだけの部品はページのテストが通り道で確かめる
 */
const STATEFUL_PATTERNS = [/\buseState\s*\(/, /\buseEffect\s*\(/, /\buseReducer\s*\(/, /\buse\w*Store\b/];

/** 部品のうち検査から除くもの。`ui/` は shadcn から写した外部由来のコード */
const EXCLUDED_COMPONENTS = [`${COMPONENTS_DIR}/ui`];

function isExcludedComponent(relative) {
  return EXCLUDED_COMPONENTS.some((prefix) => relative.startsWith(`${prefix}/`));
}

function* walk(cwd, relative) {
  const absolute = path.join(cwd, relative);
  if (!existsSync(absolute)) return;
  if (statSync(absolute).isFile()) {
    yield relative;
    return;
  }
  for (const name of readdirSync(absolute).sort()) {
    yield* walk(cwd, path.posix.join(relative, name));
  }
}

function isTest(relative) {
  return relative.endsWith(".test.ts") || relative.endsWith(".test.tsx");
}

function sourceFiles(cwd, dir) {
  return [...walk(cwd, dir)].filter((relative) => relative.endsWith(".tsx") && !isTest(relative));
}

/**
 * コメントと文字列を落とした本文。
 * JSX らしき綴りがコメントや文言の中に現れても検出しないようにするため。
 *
 * 文字列を行コメントより先に落とす。順番を逆にすると "https://..." の "//" を
 * 行コメントの始まりとみなし、その行の残りごと消してしまう
 */
export function stripCommentsAndStrings(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``")
    .replace(/\/\/[^\n]*/g, " ");
}

/**
 * `<div>` `<p aria-live=...>` のような HTML 要素の開始タグ。
 * 部品 (`<WorkCard`) は大文字で始まるので当たらない。
 *
 * タグ名の後ろに「閉じ」「属性」「展開」のどれかが続くことまで見る。
 * 名前だけで拾うと `a <b && c` のような比較まで開始タグに見えてしまう
 */
export function findHtmlJsx(relative, text) {
  const body = stripCommentsAndStrings(text);
  const match = /<([a-z][a-zA-Z0-9-]*)\s*(?:\/?>|[a-zA-Z-]+\s*=|\{)/.exec(body);
  if (!match) return [];
  const line = body.slice(0, match.index).split("\n").length;
  return [
    {
      file: relative,
      line,
      label: "ルートが画面を描いている",
      excerpt: `<${match[1]}> を src/app/pages/ へ移すこと`,
    },
  ];
}

/** `import { useState } from "react"` のように名前で入ってくるものだけを見る */
export function findRouteHooks(relative, text) {
  const findings = [];
  const lines = stripCommentsAndStrings(text).split("\n");
  for (const [index, line] of lines.entries()) {
    if (!line.startsWith("import")) continue;
    for (const name of FORBIDDEN_ROUTE_HOOKS) {
      if (new RegExp(`\\b${name}\\b`).test(line)) {
        findings.push({
          file: relative,
          line: index + 1,
          label: "ルートが画面のフックを使っている",
          excerpt: `${name} を使う部分を src/app/pages/ へ移すこと`,
        });
      }
    }
  }
  return findings;
}

function testPathFor(relative) {
  return relative.replace(/\.tsx$/, ".test.tsx");
}

function hasTestCases(cwd, testPath) {
  const absolute = path.join(cwd, testPath);
  if (!existsSync(absolute)) return false;
  return /\b(test|it)\s*\(/.test(readFileSync(absolute, "utf8"));
}

export function findMissingPageTests(cwd) {
  const findings = [];
  for (const relative of sourceFiles(cwd, PAGES_DIR)) {
    const testPath = testPathFor(relative);
    if (hasTestCases(cwd, testPath)) continue;
    findings.push({
      file: relative,
      line: 1,
      label: "ページにテストが無い",
      excerpt: `${testPath} に test を 1 つ以上置くこと`,
    });
  }
  return findings;
}

export function findMissingComponentTests(cwd) {
  const findings = [];
  for (const relative of sourceFiles(cwd, COMPONENTS_DIR)) {
    if (isExcludedComponent(relative)) continue;
    const body = stripCommentsAndStrings(readFileSync(path.join(cwd, relative), "utf8"));
    if (!STATEFUL_PATTERNS.some((pattern) => pattern.test(body))) continue;
    const testPath = testPathFor(relative);
    if (hasTestCases(cwd, testPath)) continue;
    findings.push({
      file: relative,
      line: 1,
      label: "状態を持つ部品にテストが無い",
      excerpt: `${testPath} に test を 1 つ以上置くこと`,
    });
  }
  return findings;
}

export function run({ cwd = process.cwd() } = {}) {
  const findings = [];

  for (const relative of sourceFiles(cwd, ROUTES_DIR)) {
    const text = readFileSync(path.join(cwd, relative), "utf8");
    if (!DOCUMENT_ROUTES.has(relative)) findings.push(...findHtmlJsx(relative, text));
    findings.push(...findRouteHooks(relative, text));
  }
  findings.push(...findMissingPageTests(cwd), ...findMissingComponentTests(cwd));

  if (findings.length === 0) {
    return { code: 0, findings, message: "画面の層の検査: 問題なし" };
  }
  const lines = findings.map((f) => `  ${f.file}:${f.line}  [${f.label}] ${f.excerpt}`);
  return {
    code: 1,
    findings,
    message: [
      `画面の層の検査: ${findings.length} 件`,
      ...lines,
      "",
      "規則は .claude/rules/frontend.md にある。ルートは loader と head だけを持ち、",
      "画面は src/app/pages/ に置いて隣にテストを書く。",
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
