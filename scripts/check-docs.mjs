// scripts/check-docs.mjs
//
// git 管理する文書とコードコメントを、.claude/rules/docs.md の規則に照らして機械的に検査する。
// 規則を文書に書くだけでは守られないので、`npm run check` の先頭で落とす。
// 文書の規則を足すときは、ここに検査を足すか、足せない理由を規則の側に書く。
//
// 検査するもの:
//   1. 禁止語彙 (タスク ID、節番号参照、会話の文脈を前提にした語)
//   2. docs/ 配下の各 .md の先頭にある 3 行ヘッダ (読者 / 更新 / 削除)
//   3. docs/product.md、docs/architecture.md、docs/stores/、docs/decisions/ の見出しの型と、決定の状態行
//   4. .md が指すリポジトリ内のファイルと `npm run` のスクリプトが実在するか。
//      文書とコメントが「<文書> の「見出し」」で指す見出しが実在するか
//   5. README.md の「コマンド」が package.json の scripts を漏れなく載せているか

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** 検査対象のディレクトリとファイル (cwd からの相対) */
const ROOTS = [
  "docs",
  ".claude",
  "CLAUDE.md",
  "README.md",
  "src",
  "crawler",
  "scripts",
  "e2e",
  ".github",
  "wrangler.jsonc",
  ".dev.vars.example",
];

const EXTENSIONS = new Set([".md", ".ts", ".tsx", ".mjs", ".yml", ".yaml", ".jsonc", ".example"]);

/** 検査から除くパス。禁止語彙そのものを列挙しているファイルと、生成物・外部の HTML */
const EXCLUDED = [
  "scripts/check-docs.mjs",
  "scripts/check-docs.test.ts",
  ".claude/worktrees",
  "crawler/fixtures",
  "crawler/.cache",
  "src/app/routeTree.gen.ts",
  "node_modules",
];

/**
 * 禁止語彙。`T` + 数字は ISO 8601 の `T00:00:00` を除く (`:` が続くものは日時)。
 * `§` は、同じ行に文書名か「設計書 / 企画書」があるときだけ節番号参照とみなす
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

/**
 * docs/product.md と docs/architecture.md の h2 見出し。この順で、これ以外を置かない。
 * 範囲外のもの (外部サイトの制約、進行、実装の事実) は新しい節として入り込むので、節を足すには
 * ここを変える差分が要るようにして、.claude/rules/docs.md の判定表に照らす機会を作る。
 * 大きさで測らないのは、上限の値に根拠が無く、上限に当たったときに言い回しを詰めて逃げられるため
 */
export const PRODUCT_HEADINGS = [
  "製品",
  "作らないもの",
  "対象声優",
  "対象作品",
  "新着",
  "通知",
  "別名義",
  "差別化の軸",
];
export const ARCHITECTURE_HEADINGS = [
  "構成要素",
  "取得の周期",
  "通知の送信",
  "依存方向",
  "クローラーと Worker の契約",
  "データの不変条件",
  "外部アクセスの不変条件",
  "画面と公開 API",
  "秘匿値",
  "ローカル環境",
  "未実装",
];

/**
 * docs/stores/<store>.md の h2 見出し。この順で、これ以外を置かない。
 * 使う URL の形・取れる項目・セレクタは adapter のコードが持つので、それを書く節を作らせない
 */
export const STORE_HEADINGS = [
  "robots.txt",
  "レート間隔",
  "使ってはいけない URL",
  "既知の落とし穴",
  "未確認の項目",
  "出典",
];

/** docs/decisions/NNNN-*.md の h2 見出し */
export const DECISION_HEADINGS = ["状況", "決定", "帰結", "採らなかった案"];
const DECISION_STATUS = /^状態: (accepted|superseded) \(\d{4}-\d{2}-\d{2}\)/m;

/**
 * .md が指すリポジトリ内のパス。拡張子は長いものを先に並べる (`.json` を `.js` で切らない)。
 * 直後に語の続きが来るものは別のファイル名の一部なので拾わない
 */
const PATH_REFERENCE =
  /(?<![\w/.-])((?:scripts|crawler|src|e2e|migrations|docs|\.github|\.claude|public)\/[\w./@-]*?[\w-]\.(?:tsx|ts|mjs|jsonc|json|js|sh|md|yml|yaml|sql|css|svg))(?![\w.])/g;

/** 実在を問わないパス。git 管理外の置き場は手元にしか無く、CI では存在しない */
const PATH_CHECK_SKIPPED_PREFIXES = ["crawler/.cache/", "work/", ".claude/worktrees/"];
/** docs/research/ は日付つきの記録で、当時あったファイルを指したまま書き換えない */
const PATH_CHECK_SKIPPED_DOCS = ["docs/research/"];

/** Markdown のリンク先。外部 URL とページ内のアンカーだけのものは除いて相対パスとして解決する */
const MARKDOWN_LINK = /\]\((?!https?:|mailto:|#)([^)\s#]+)(?:#[^)]*)?\)/g;

const NPM_RUN = /npm run ([\w:-]+)/g;

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

/** 1 始まりの行番号 */
function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
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

function h2Headings(text) {
  return [...text.matchAll(/^## (.+)$/gm)].map((match) => match[1].trim());
}

function headingFindings(relative, actual, expected) {
  if (actual.join("\n") === expected.join("\n")) return [];
  return [
    {
      file: relative,
      line: 1,
      label: "見出しの型",
      excerpt: `[${actual.join(" / ")}] が [${expected.join(" / ")}] と一致しない`,
    },
  ];
}

export function findShapeViolations(relative, text) {
  if (relative === "docs/product.md") {
    return headingFindings(relative, h2Headings(text), PRODUCT_HEADINGS);
  }
  if (relative === "docs/architecture.md") {
    return headingFindings(relative, h2Headings(text), ARCHITECTURE_HEADINGS);
  }
  if (/^docs\/stores\/(?!README\.md$)[^/]+\.md$/.test(relative)) {
    return headingFindings(relative, h2Headings(text), STORE_HEADINGS);
  }
  if (/^docs\/decisions\/\d{4}-[^/]+\.md$/.test(relative)) {
    const findings = headingFindings(relative, h2Headings(text), DECISION_HEADINGS);
    if (!DECISION_STATUS.test(text)) {
      findings.push({
        file: relative,
        line: 1,
        label: "決定の状態行",
        excerpt: "「状態: accepted (YYYY-MM-DD)」か「状態: superseded (YYYY-MM-DD)」が無い",
      });
    }
    return findings;
  }
  return [];
}

export function findDanglingReferences(relative, text, { cwd, scripts }) {
  if (path.extname(relative) !== ".md") return [];
  const findings = [];
  if (!PATH_CHECK_SKIPPED_DOCS.some((prefix) => relative.startsWith(prefix))) {
    for (const match of text.matchAll(PATH_REFERENCE)) {
      const target = match[1];
      if (PATH_CHECK_SKIPPED_PREFIXES.some((prefix) => target.startsWith(prefix))) continue;
      if (existsSync(path.join(cwd, target))) continue;
      findings.push({
        file: relative,
        line: lineOf(text, match.index),
        label: "存在しないファイル",
        excerpt: target,
      });
    }
    for (const match of text.matchAll(MARKDOWN_LINK)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(relative), match[1]));
      if (PATH_CHECK_SKIPPED_PREFIXES.some((prefix) => target.startsWith(prefix))) continue;
      if (existsSync(path.join(cwd, target))) continue;
      findings.push({
        file: relative,
        line: lineOf(text, match.index),
        label: "存在しないリンク先",
        excerpt: match[1],
      });
    }
  }
  for (const match of text.matchAll(NPM_RUN)) {
    if (scripts.has(match[1])) continue;
    findings.push({
      file: relative,
      line: lineOf(text, match.index),
      label: "存在しないスクリプト",
      excerpt: `npm run ${match[1]}`,
    });
  }
  return findings;
}

/**
 * 「`docs/x.md` の「見出し」」と「[`x.md`](../x.md) の「見出し」」の形の参照。
 * 文書は見出し語で指す規則なので、指した見出しが消えたり名前を変えたりしたら参照が宙に浮く
 */
const HEADING_REFERENCE =
  /(?:`?((?:docs|\.claude)\/[\w./-]+\.md|README(?:\.md)?|CLAUDE\.md)`?|\]\(((?:\.\.?\/)?[\w./-]+\.md)\))\s*の「([^」\n]+)」/g;

export function findBrokenHeadingReferences(relative, text, { cwd }) {
  if (PATH_CHECK_SKIPPED_DOCS.some((prefix) => relative.startsWith(prefix))) return [];
  const findings = [];
  for (const match of text.matchAll(HEADING_REFERENCE)) {
    // パスを付けない README はどこから書いても直下のものを指す。書く場所で指す先が変わると、
    // 同じ文字列が文書ごとに別の README を意味してしまう。下の README はパスで書く
    const target =
      match[1] === "README" || match[1] === "README.md"
        ? "README.md"
        : (match[1] ??
          path.posix.normalize(path.posix.join(path.posix.dirname(relative), match[2])));
    const absolute = path.join(cwd, target);
    // ファイルそのものが無いときは findDanglingReferences が拾う
    if (!existsSync(absolute)) continue;
    const content = readFileSync(absolute, "utf8");
    const headings = content.split("\n").filter((line) => /^#{1,6} /.test(line));
    // 箇条書きの先頭に太字で置いた見出し語 (`- **シーズンごと**: ...`) も見出しとして扱う
    if (headings.some((line) => line.includes(match[3])) || content.includes(`**${match[3]}**`)) {
      continue;
    }
    findings.push({
      file: relative,
      line: lineOf(text, match.index),
      label: "存在しない見出し",
      excerpt: `${target} の「${match[3]}」`,
    });
  }
  return findings;
}

/**
 * README.md の「コマンド」節が package.json の scripts を全部載せているか
 */
export function findUnlistedScripts(readme, scripts) {
  const section = /^## コマンド\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(readme);
  if (section === null) {
    return [{ file: "README.md", line: 1, label: "コマンド一覧", excerpt: "「## コマンド」が無い" }];
  }
  // 1 つの行に `npm run a` / `b` と並べる書き方を許すため、節の中のコード片を全部見る
  const listed = new Set(
    [...section[1].matchAll(/`(?:npm run )?([\w:-]+)[^`]*`/g)].map((match) => match[1]),
  );
  return [...scripts]
    .filter((name) => !listed.has(name))
    .map((name) => ({
      file: "README.md",
      line: lineOf(readme, section.index),
      label: "コマンド一覧に無い",
      excerpt: `npm run ${name}`,
    }));
}

function readScripts(cwd) {
  const packageJson = path.join(cwd, "package.json");
  if (!existsSync(packageJson)) return new Set();
  return new Set(Object.keys(JSON.parse(readFileSync(packageJson, "utf8")).scripts ?? {}));
}

export function run({ cwd = process.cwd() } = {}) {
  const scripts = readScripts(cwd);
  const findings = [];
  for (const relative of listTargets(cwd)) {
    const text = readFileSync(path.join(cwd, relative), "utf8");
    findings.push(
      ...findForbidden(relative, text),
      ...findMissingHeader(relative, text),
      ...findShapeViolations(relative, text),
      ...findDanglingReferences(relative, text, { cwd, scripts }),
      ...findBrokenHeadingReferences(relative, text, { cwd }),
    );
    if (relative === "README.md") findings.push(...findUnlistedScripts(text, scripts));
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
      "規則は .claude/rules/docs.md にある。",
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
