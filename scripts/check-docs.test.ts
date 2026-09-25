// scripts/check-docs.test.ts
//
// 実際のリポジトリには触れず、一時ディレクトリに作ったファイルに対してだけ検査する。

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CHAR_LIMITS,
  DECISION_HEADINGS,
  findBrokenHeadingReferences,
  findDanglingReferences,
  findForbidden,
  findMissingHeader,
  findOverLimit,
  findShapeViolations,
  findUnlistedScripts,
  run,
  STORE_HEADINGS,
} from "./check-docs.mjs";

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

function makeRepo(files: Record<string, string>): string {
  tempDir = mkdtempSync(path.join(tmpdir(), "check-docs-test-"));
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(tempDir, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  return tempDir;
}

const HEADER = "読者: 開発者\n更新: 設計が変わったら\n削除: しない\n\n";

describe("findForbidden", () => {
  it("タスク ID と節番号参照と会話の文脈を前提にした語を拾う", () => {
    const text = [
      "// 版の検査 (T16)",
      "// 設計書 §6 のとおり",
      "// docs/decisions.md §14 を参照",
      "// 夜間の作業で決めた",
      "// 問題のない行",
    ].join("\n");
    const found = findForbidden("src/a.ts", text);
    expect(found.map((f) => f.line)).toEqual([1, 2, 3, 4]);
  });

  it("ISO 8601 の T00:00:00 はタスク ID とみなさない", () => {
    expect(findForbidden("src/a.ts", "const d = `${date}T00:00:00Z`;")).toEqual([]);
  });

  it("ファイル内部の節参照 (§2) は許す", () => {
    expect(findForbidden("docs/stores/x.md", "根拠は §2 にある")).toEqual([]);
  });
});

describe("findMissingHeader", () => {
  it("docs/ 配下の .md に 3 行ヘッダが無ければ拾う", () => {
    const found = findMissingHeader("docs/x.md", "# 題\n\n本文");
    expect(found).toHaveLength(1);
    expect(found[0]?.excerpt).toBe("読者: 更新: 削除:");
  });

  it("ヘッダがあれば通す。docs/ 以外は見ない", () => {
    expect(findMissingHeader("docs/x.md", `# 題\n\n${HEADER}本文`)).toEqual([]);
    expect(findMissingHeader("src/x.ts", "// no header")).toEqual([]);
  });
});

describe("findOverLimit", () => {
  it("上限のある文書だけ文字数を見る。行を長くしても逃げられない", () => {
    const oneLongLine = "あ".repeat(CHAR_LIMITS["docs/architecture.md"] + 1);
    expect(findOverLimit("docs/architecture.md", oneLongLine)).toHaveLength(1);
    expect(findOverLimit("docs/stores/dlsite.md", oneLongLine)).toEqual([]);
  });
});

const STORE_BODY = `# 店\n\n${HEADER}${STORE_HEADINGS.map((h) => `## ${h}\n\n本文\n`).join("\n")}`;
const DECISION_BODY = `# 決定\n\n${HEADER}状態: accepted (2026-09-20)\n\n${DECISION_HEADINGS.map((h) => `## ${h}\n\n本文\n`).join("\n")}`;

describe("findShapeViolations", () => {
  it("stores の見出しが型どおりなら通す。README は見ない", () => {
    expect(findShapeViolations("docs/stores/x.md", STORE_BODY)).toEqual([]);
    expect(findShapeViolations("docs/stores/README.md", "## 何でも")).toEqual([]);
  });

  it("stores に型に無い見出し (使う URL など) があれば拾う", () => {
    const text = STORE_BODY.replace("## 既知の落とし穴", "## 使う URL\n\n本文\n\n## 既知の落とし穴");
    expect(findShapeViolations("docs/stores/x.md", text)).toHaveLength(1);
  });

  it("決定の見出しと状態行を見る", () => {
    expect(findShapeViolations("docs/decisions/0001-x.md", DECISION_BODY)).toEqual([]);
    const noStatus = DECISION_BODY.replace("状態: accepted (2026-09-20)", "状態: 帰結だけ置き換えた");
    expect(findShapeViolations("docs/decisions/0001-x.md", noStatus).map((f) => f.label)).toEqual([
      "決定の状態行",
    ]);
  });
});

describe("findDanglingReferences", () => {
  it("存在しないファイルと npm run のスクリプトを拾う。research と git 管理外の置き場は見ない", () => {
    const cwd = makeRepo({ "scripts/a.mjs": "" });
    const scripts = new Set(["check"]);
    const text = [
      "`scripts/a.mjs` と `scripts/gone.mjs`",
      "`npm run check` と `npm run gone`",
      "`crawler/.cache/x.json`",
    ].join("\n");
    const found = findDanglingReferences("README.md", text, { cwd, scripts });
    expect(found.map((f) => f.excerpt)).toEqual(["scripts/gone.mjs", "npm run gone"]);
    expect(
      findDanglingReferences("docs/research/x-2026-09-20.md", "`scripts/gone.mjs`", { cwd, scripts }),
    ).toEqual([]);
  });

  it("Markdown の相対リンクの先も見る。外部 URL とアンカーは見ない", () => {
    const cwd = makeRepo({ "docs/stores/x.md": "" });
    const text = [
      "[ok](../../docs/stores/x.md#robots)",
      "[ng](../../docs/stores/gone.md)",
      "[web](https://example.com/a.md)",
      "[anchor](#見出し)",
    ].join("\n");
    const found = findDanglingReferences(".claude/rules/a.md", text, { cwd, scripts: new Set() });
    expect(found.map((f) => f.excerpt)).toEqual(["../../docs/stores/gone.md"]);
  });

  it(".json を .js で切らず、.tsx を .ts で切らない", () => {
    const cwd = makeRepo({ "src/a.tsx": "", "crawler/b.json": "" });
    const text = "`src/a.tsx` と `crawler/b.json`";
    expect(findDanglingReferences("README.md", text, { cwd, scripts: new Set() })).toEqual([]);
  });
});

describe("findBrokenHeadingReferences", () => {
  it("パスと見出し語で指した先に見出しか太字の見出し語が無ければ拾う", () => {
    const cwd = makeRepo({
      "docs/stores/x.md": "# 店\n\n## 既知の落とし穴\n\n- **新着**: 本文\n",
      "docs/decisions/0001-a.md": "# 決定\n",
    });
    const text = [
      "// `docs/stores/x.md` の「既知の落とし穴」",
      "// docs/stores/x.md の「新着」",
      "// docs/stores/x.md の「使う URL」",
    ].join("\n");
    const found = findBrokenHeadingReferences("crawler/a.ts", text, { cwd });
    expect(found.map((f) => f.line)).toEqual([3]);
  });

  it("文書からの相対リンクも解決する", () => {
    const cwd = makeRepo({ "docs/stores/x.md": "# 店\n\n## robots.txt\n" });
    const ok = "[`x.md`](../stores/x.md) の「robots.txt」";
    const ng = "[`x.md`](../stores/x.md) の「2 ページ目以降」";
    expect(findBrokenHeadingReferences("docs/decisions/0001-a.md", ok, { cwd })).toEqual([]);
    expect(findBrokenHeadingReferences("docs/decisions/0001-a.md", ng, { cwd })).toHaveLength(1);
  });
});

describe("findUnlistedScripts", () => {
  it("README の「コマンド」節に無いスクリプトを拾う。1 行に並べた書き方も数える", () => {
    const readme = [
      "# x",
      "## コマンド",
      "| `npm run dev` | 開発 |",
      "| `npm run db:migrate:local` / `db:migrate:remote` | 適用 |",
      "## 次の節",
      "`npm run test`",
    ].join("\n");
    const scripts = new Set(["dev", "db:migrate:local", "db:migrate:remote", "test"]);
    expect(findUnlistedScripts(readme, scripts).map((f) => f.excerpt)).toEqual(["npm run test"]);
  });
});

describe("run", () => {
  it("問題が無ければ終了コード 0", () => {
    const cwd = makeRepo({
      "docs/x.md": `# 題\n\n${HEADER}本文`,
      "src/a.ts": "// なぜこの行か\n",
    });
    expect(run({ cwd }).code).toBe(0);
  });

  it("問題があれば終了コード 1 で、ファイルと行を列挙する", () => {
    const cwd = makeRepo({
      "docs/x.md": "# 題\n\n本文 (T16)",
      "crawler/fixtures/page.html": "T16 は除外対象なので見ない",
    });
    const result = run({ cwd });
    expect(result.code).toBe(1);
    expect(result.findings.map((f) => `${f.file}:${f.line}`)).toEqual(["docs/x.md:3", "docs/x.md:1"]);
    expect(result.message).toContain("docs/x.md:3");
  });
});
