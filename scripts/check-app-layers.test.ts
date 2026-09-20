// scripts/check-app-layers.test.ts
//
// 実際のリポジトリには触れず、一時ディレクトリに作ったファイルに対してだけ検査する。

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findHtmlJsx,
  findMissingComponentTests,
  findMissingPageTests,
  findRouteHooks,
  run,
  stripCommentsAndStrings,
} from "./check-app-layers.mjs";

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

function makeRepo(files: Record<string, string>): string {
  tempDir = mkdtempSync(path.join(tmpdir(), "check-app-layers-test-"));
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(tempDir, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  return tempDir;
}

/** 検査を通る最小のルート。loader と、ページへ渡すだけの component */
const CLEAN_ROUTE = `import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "@/app/pages/home";

export const Route = createFileRoute("/")({
  component: RouteComponent,
});

function RouteComponent() {
  return <HomePage latestByStore={Route.useLoaderData().latestByStore} />;
}
`;

describe("findHtmlJsx", () => {
  it("ルートに HTML 要素の JSX があれば拾う", () => {
    const found = findHtmlJsx("src/app/routes/index.tsx", 'function P() {\n  return <div className="x" />;\n}');
    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe(2);
    expect(found[0]?.excerpt).toContain("<div>");
  });

  it("部品だけを組み立てるルートは通す", () => {
    expect(findHtmlJsx("src/app/routes/index.tsx", CLEAN_ROUTE)).toEqual([]);
  });

  it("コメントの中の綴りは拾わない", () => {
    const text = "// <div> をページへ移した\n/* <p> も同様 */\nexport const x = 1;";
    expect(findHtmlJsx("src/app/routes/index.tsx", text)).toEqual([]);
  });

  it("文字列の中の綴りは拾わない", () => {
    expect(findHtmlJsx("src/app/routes/index.tsx", 'const s = "<div>";')).toEqual([]);
  });

  it("比較演算子は開始タグとみなさない", () => {
    expect(findHtmlJsx("src/app/routes/index.tsx", "const ok = a <b && c;")).toEqual([]);
  });
});

describe("findRouteHooks", () => {
  it("react の状態フックを import していれば拾う", () => {
    const found = findRouteHooks("src/app/routes/a.tsx", 'import { useState } from "react";');
    expect(found).toHaveLength(1);
    expect(found[0]?.excerpt).toContain("useState");
  });

  it("表示言語のフックも拾う", () => {
    const found = findRouteHooks("src/app/routes/a.tsx", 'import { useT, useLocale } from "@/app/i18n";');
    expect(found.map((f) => f.excerpt)).toEqual([
      expect.stringContaining("useT"),
      expect.stringContaining("useLocale"),
    ]);
  });

  it("head() に要る createTranslator は許す", () => {
    expect(findRouteHooks("src/app/routes/a.tsx", 'import { createTranslator } from "@/app/i18n";')).toEqual([]);
  });

  it("import 以外の行にある同じ名前は拾わない", () => {
    expect(findRouteHooks("src/app/routes/a.tsx", "const useState = 1;")).toEqual([]);
  });
});

describe("findMissingPageTests", () => {
  it("隣にテストが無いページを拾う", () => {
    const cwd = makeRepo({ "src/app/pages/home.tsx": "export const x = 1;" });
    const found = findMissingPageTests(cwd);
    expect(found).toHaveLength(1);
    expect(found[0]?.excerpt).toContain("src/app/pages/home.test.tsx");
  });

  it("テストはあるが中身が空なら拾う", () => {
    const cwd = makeRepo({
      "src/app/pages/home.tsx": "export const x = 1;",
      "src/app/pages/home.test.tsx": "// あとで書く",
    });
    expect(findMissingPageTests(cwd)).toHaveLength(1);
  });

  it("test が 1 つでもあれば通す", () => {
    const cwd = makeRepo({
      "src/app/pages/home.tsx": "export const x = 1;",
      "src/app/pages/home.test.tsx": 'test("出る", () => {});',
    });
    expect(findMissingPageTests(cwd)).toEqual([]);
  });

  it("入れ子のページも見る", () => {
    const cwd = makeRepo({ "src/app/pages/admin/health.tsx": "export const x = 1;" });
    expect(findMissingPageTests(cwd)).toHaveLength(1);
  });
});

describe("findMissingComponentTests", () => {
  it("状態を持つ部品にテストが無ければ拾う", () => {
    const cwd = makeRepo({
      "src/app/components/tabs.tsx": "const [a, b] = useState(0);",
    });
    expect(findMissingComponentTests(cwd)).toHaveLength(1);
  });

  it("保存を読む部品も対象にする", () => {
    const cwd = makeRepo({
      "src/app/components/badge.tsx": "const n = useFollowStore((s) => s.follows);",
    });
    expect(findMissingComponentTests(cwd)).toHaveLength(1);
  });

  it("props を並べるだけの部品はテストを求めない", () => {
    const cwd = makeRepo({
      "src/app/components/page-header.tsx": "export function PageHeader() { return null; }",
    });
    expect(findMissingComponentTests(cwd)).toEqual([]);
  });

  /** `ui/` は shadcn から写した外部由来のコード */
  it("ui/ 配下は対象にしない", () => {
    const cwd = makeRepo({ "src/app/components/ui/select.tsx": "const [a] = useState(0);" });
    expect(findMissingComponentTests(cwd)).toEqual([]);
  });
});

describe("run", () => {
  it("違反が無ければ 0 を返す", () => {
    const cwd = makeRepo({
      "src/app/routes/index.tsx": CLEAN_ROUTE,
      "src/app/pages/home.tsx": "export const x = 1;",
      "src/app/pages/home.test.tsx": 'test("出る", () => {});',
    });
    expect(run({ cwd }).code).toBe(0);
  });

  it("違反があれば 1 を返し、規則の置き場所を出す", () => {
    const cwd = makeRepo({
      "src/app/routes/index.tsx": "function P() { return <div />; }",
    });
    const result = run({ cwd });
    expect(result.code).toBe(1);
    expect(result.message).toContain(".claude/rules/frontend.md");
  });

  /** `__root.tsx` は <html> から <body> までの文書そのものを組み立てる */
  it("__root.tsx の HTML 要素は許すが、フックは許さない", () => {
    const cwd = makeRepo({
      "src/app/routes/__root.tsx": '<html lang="ja"><body /></html>;',
    });
    expect(run({ cwd }).code).toBe(0);

    const withHook = makeRepo({
      "src/app/routes/__root.tsx": 'import { useEffect } from "react";\n<html />;',
    });
    expect(run({ cwd: withHook }).code).toBe(1);
  });

  it("テストファイル自体はページとして数えない", () => {
    const cwd = makeRepo({ "src/app/pages/home.test.tsx": 'test("出る", () => {});' });
    expect(run({ cwd }).code).toBe(0);
  });
});

describe("stripCommentsAndStrings", () => {
  /** 文字列の中の "//" で行の残りを消すと、その後ろの JSX を見落とす */
  it("文字列の中の URL が、同じ行の後ろを巻き込まない", () => {
    const body = stripCommentsAndStrings('const u = "https://example.com"; return <div />;');
    expect(body).toContain("<div");
  });

  it("行コメントは落とす", () => {
    expect(stripCommentsAndStrings("const a = 1; // <div /> を移した")).not.toContain("<div");
  });
});
