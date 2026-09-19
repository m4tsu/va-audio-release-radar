// scripts/check-docs.test.ts
//
// 実際のリポジトリには触れず、一時ディレクトリに作ったファイルに対してだけ検査する。

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findForbidden, findMissingHeader, findOverLimit, run } from "./check-docs.mjs";

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
  it("上限のある文書だけ行数を見る", () => {
    const long = Array.from({ length: 151 }, () => "x").join("\n");
    expect(findOverLimit("docs/architecture.md", long)).toHaveLength(1);
    expect(findOverLimit("docs/stores/dlsite.md", long)).toEqual([]);
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
