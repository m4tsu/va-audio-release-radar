// scripts/check-entrypoints.test.ts
//
// 実際のリポジトリには触れず、一時ディレクトリに作ったファイルに対してだけ検査する。

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listEntrypoints, run } from "./check-entrypoints.mjs";

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

function makeRepo(files: Record<string, string>): string {
  tempDir = mkdtempSync(path.join(tmpdir(), "check-entrypoints-test-"));
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(tempDir, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  return tempDir;
}

const MAIN = "if (import.meta.url === pathToFileURL(process.argv[1]).href) main();\n";

describe("listEntrypoints", () => {
  it("scripts/ の .mjs と .sh、どこでも直接起動を判定しているファイルを拾う", () => {
    const cwd = makeRepo({
      "scripts/tool.mjs": "console.log(1);\n",
      "scripts/run.sh": "echo 1\n",
      "crawler/job.ts": MAIN,
      "crawler/lib/helper.ts": "export const x = 1;\n",
    });
    expect(listEntrypoints(cwd).sort()).toEqual(["crawler/job.ts", "scripts/run.sh", "scripts/tool.mjs"]);
  });

  it("他から import される scripts/ の .mjs は部品として除く。テストも除く", () => {
    const cwd = makeRepo({
      "scripts/lib.mjs": "export const x = 1;\n",
      "scripts/tool.mjs": `import { x } from "./lib.mjs";\n${MAIN}`,
      "scripts/tool.test.ts": MAIN,
    });
    expect(listEntrypoints(cwd)).toEqual(["scripts/tool.mjs"]);
  });
});

describe("run", () => {
  it("package.json・.github・.claude のどこかが実行していれば通す", () => {
    const cwd = makeRepo({
      "package.json": JSON.stringify({ scripts: { job: "node crawler/job.ts" } }),
      ".github/workflows/x.yml": "run: node scripts/tool.mjs\n",
      ".claude/skills/a/SKILL.md": "bash scripts/run.sh\n",
      "crawler/job.ts": MAIN,
      "scripts/tool.mjs": "console.log(1);\n",
      "scripts/run.sh": "echo 1\n",
    });
    expect(run({ cwd }).code).toBe(0);
  });

  it("どこからも実行されていないファイルを列挙して終了コード 1", () => {
    const cwd = makeRepo({
      "package.json": JSON.stringify({ scripts: {} }),
      "README.md": "node scripts/once.mjs で一度だけ流す\n",
      "scripts/once.mjs": "console.log(1);\n",
    });
    const result = run({ cwd });
    expect(result.code).toBe(1);
    // README に書いてあるだけでは実行の経路とみなさない
    expect(result.unreferenced).toEqual(["scripts/once.mjs"]);
  });
});
