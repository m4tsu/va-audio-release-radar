// scripts/issue-body.test.ts

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadFields, parseBody, renderBody, summarize } from "./issue-body.mjs";

const TEMPLATE = `
name: タスク
body:
  - type: markdown
    attributes:
      value: 説明だけの欄は本文に出ない
  - type: textarea
    id: purpose
    attributes:
      label: 目的
      description: 何が起きるか
    validations:
      required: true
  - type: textarea
    id: note
    attributes:
      label: 備考
  - type: checkboxes
    id: areas
    attributes:
      label: 触る場所
      options:
        - label: src/app
        - label: スキーマ (migrations)
`;

const fields = loadFields(TEMPLATE);

describe("renderBody", () => {
  it("欄の定義の順に、GitHub のフォームと同じ形で書く", () => {
    const body = renderBody(fields, { purpose: "表示が出る", areas: ["src/app"] });
    expect(body).toBe(
      [
        "### 目的",
        "",
        "表示が出る",
        "",
        "### 備考",
        "",
        "_No response_",
        "",
        "### 触る場所",
        "",
        "- [X] src/app",
        "- [ ] スキーマ (migrations)",
        "",
      ].join("\n"),
    );
  });

  it("必須の欄の空、知らない欄、知らない選択肢は作らせない", () => {
    expect(() => renderBody(fields, { purpose: " " })).toThrow("必須");
    expect(() => renderBody(fields, { purpose: "a", title: "x" })).toThrow("テンプレートに無い欄");
    expect(() => renderBody(fields, { purpose: "a", areas: ["crawler"] })).toThrow("選択肢");
  });
});

describe("parseBody", () => {
  it("作った本文を読み戻せる", () => {
    const values = { purpose: "表示が出る", note: "- 1 行目\n- 2 行目", areas: ["スキーマ (migrations)"] };
    expect(parseBody(fields, renderBody(fields, values))).toEqual(values);
  });

  it("Web のフォームが小文字の [x] で書いたチェックも読む。欄の無い本文は空", () => {
    expect(parseBody(fields, "### 触る場所\n\n- [x] src/app\n- [ ] スキーマ (migrations)")).toEqual({
      areas: ["src/app"],
    });
    expect(parseBody(fields, "自由に書いた本文")).toEqual({});
  });
});

describe("summarize", () => {
  const issue = (number: number, labels: string[], body: string) => ({
    number,
    title: `t${number}`,
    body,
    labels: labels.map((name) => ({ name })),
  });

  it("優先度順に並べ、依存・スキーマ変更・触る場所を出す", () => {
    const lines = summarize(fields, [
      issue(3, ["p2"], renderBody(fields, { purpose: "a", areas: ["src/app"] })),
      issue(5, [], "欄の無い本文。#3 に依存"),
      issue(4, ["p1", "ready"], renderBody(fields, { purpose: "b", areas: ["スキーマ (migrations)"] })),
    ]);
    expect(lines).toEqual([
      "#4\tp1\tt4\tlabels=p1,ready\tdeps=-\tschema=yes\tareas=スキーマ (migrations)",
      "#3\tp2\tt3\tlabels=p2\tdeps=-\tschema=no\tareas=src/app",
      "#5\tp-\tt5\tlabels=\tdeps=#3\tschema=?\tareas=?",
    ]);
  });
});

describe("欄の定義の置き場", () => {
  /**
   * 欄の見出しを写してよいのは task.yml だけ。スキルの手順やシェルに写すと、欄を変えたときに
   * 写しだけが古くなり、issue-batch の判定が黙って外れる
   */
  it("スキルと GitHub の設定に task.yml の見出しを写していない", () => {
    const root = path.join(import.meta.dirname, "..");
    const realFields = loadFields();
    const headings = realFields.map((field) => `### ${field.label}`);
    const files = [...walk(path.join(root, ".claude", "skills")), ...walk(path.join(root, ".github"))].filter(
      (file) => !file.includes(`${path.sep}ISSUE_TEMPLATE${path.sep}`),
    );
    const copies = files.flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return headings.filter((heading) => text.includes(heading)).map((heading) => `${file}: ${heading}`);
    });
    expect(copies).toEqual([]);
  });
});

function* walk(directory: string): Generator<string> {
  for (const name of readdirSync(directory)) {
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}
