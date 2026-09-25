// scripts/issue-body.mjs
//
// issue の本文を .github/ISSUE_TEMPLATE/task.yml の欄の定義から作り、読む。
// 欄の見出し・並び・選択肢の正は task.yml だけにする。スキルの文書やシェルに見出しを写すと、
// 欄を変えたときに写しの片方だけが古くなり、issue-batch の並列の判定が黙って外れる。
//
//   node scripts/issue-body.mjs template             # 欄の id・見出し・必須・選択肢を出す
//   node scripts/issue-body.mjs render < fields.json  # 欄の id をキーにした JSON から本文を作る
//   node scripts/issue-body.mjs summarize <issues.json>  # issue-batch の collect.sh が使う 1 行ずつの要約
//
// 本文の形は GitHub の issue フォームが作るものと同じにする (`### 見出し` と値、
// 空の欄は `_No response_`、チェックは `- [X] 選択肢`)。Web のフォームで作った issue も同じ読み方で読めるため。

import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";

export const TEMPLATE_PATH = path.join(
  import.meta.dirname,
  "..",
  ".github",
  "ISSUE_TEMPLATE",
  "task.yml",
);

/** GitHub のフォームが空の欄に書く値 */
const NO_RESPONSE = "_No response_";

/**
 * 「触る場所の見込み」のうち、同時に 1 つしか動かさない (スキーマ変更) 選択肢の見分け方。
 * migrations の連番と meta/_journal.json が並行する 2 つの変更で両立しないため
 */
const SCHEMA_OPTION_PREFIX = "スキーマ";

/** 本文のどこに書かれていても依存とみなす書き方。欄を使わずに書かれた issue も拾うため */
const DEPENDENCY = /(?:depends on|blocked by|依存)[^\n]*?#(\d+)|#(\d+)\s*に依存/gi;

/**
 * @typedef {{ id: string; type: "textarea" | "input" | "checkboxes" | "dropdown"; label: string;
 *   description: string; required: boolean; options?: string[] }} Field
 */

/** @returns {Field[]} */
export function loadFields(yamlText = readFileSync(TEMPLATE_PATH, "utf8")) {
  const template = parseYaml(yamlText);
  return template.body
    .filter((item) => item.type !== "markdown")
    .map((item) => ({
      id: item.id,
      type: item.type,
      label: item.attributes.label,
      description: item.attributes.description ?? "",
      required: item.validations?.required === true,
      ...(item.type === "checkboxes"
        ? { options: item.attributes.options.map((option) => option.label) }
        : item.type === "dropdown"
          ? { options: item.attributes.options }
          : {}),
    }));
}

/**
 * 欄の id をキーにした値から本文を作る。テキストの欄は文字列、チェックの欄は選んだ選択肢の配列。
 * 知らない id、知らない選択肢、必須の欄の空は投げる。形の崩れた本文を作らせないため
 *
 * @param {Field[]} fields
 * @param {Record<string, string | string[] | undefined>} values
 */
export function renderBody(fields, values) {
  const known = new Set(fields.map((field) => field.id));
  const unknown = Object.keys(values).filter((id) => !known.has(id));
  if (unknown.length > 0) throw new Error(`テンプレートに無い欄: ${unknown.join(", ")}`);

  const sections = fields.map((field) => {
    const value = values[field.id];
    if (field.type === "checkboxes") {
      const checked = Array.isArray(value) ? value : [];
      const invalid = checked.filter((label) => !field.options?.includes(label));
      if (invalid.length > 0) {
        throw new Error(`「${field.label}」に無い選択肢: ${invalid.join(", ")}`);
      }
      const lines = (field.options ?? []).map(
        (option) => `- [${checked.includes(option) ? "X" : " "}] ${option}`,
      );
      return `### ${field.label}\n\n${lines.join("\n")}`;
    }
    const text = typeof value === "string" ? value.trim() : "";
    if (text === "" && field.required) throw new Error(`必須の欄が空: ${field.label}`);
    return `### ${field.label}\n\n${text === "" ? NO_RESPONSE : text}`;
  });
  return `${sections.join("\n\n")}\n`;
}

/**
 * 本文を欄ごとに読む。テンプレートの見出しに当たらない本文は、欄が無いものとして空を返す
 *
 * @param {Field[]} fields
 * @param {string} body
 * @returns {Record<string, string | string[]>}
 */
export function parseBody(fields, body) {
  const byLabel = new Map(fields.map((field) => [field.label, field]));
  /** @type {Record<string, string | string[]>} */
  const values = {};
  const headings = [...body.matchAll(/^### (.+)$/gm)];
  for (const [index, heading] of headings.entries()) {
    const field = byLabel.get(heading[1].trim());
    if (field === undefined) continue;
    const start = (heading.index ?? 0) + heading[0].length;
    const end = headings[index + 1]?.index ?? body.length;
    const content = body.slice(start, end).trim();
    if (field.type === "checkboxes") {
      values[field.id] = [...content.matchAll(/^- \[[xX]\] (.+)$/gm)].map((match) => match[1].trim());
    } else {
      values[field.id] = content === NO_RESPONSE ? "" : content;
    }
  }
  return values;
}

/**
 * issue-batch の並べ替えと、並列にできるかの判定に要るものだけを 1 行にする。
 * 出力は優先度 (p1 → p2 → p3 → 無し)、同じなら番号の順
 *
 * @param {Field[]} fields
 * @param {{ number: number; title: string; body?: string; labels: { name: string }[] }[]} issues
 */
export function summarize(fields, issues) {
  const areaField = fields.find((field) => field.type === "checkboxes");
  const rank = (issue) => {
    const priority = issue.labels.map((label) => label.name).find((name) => /^p[123]$/.test(name));
    return priority ? Number(priority[1]) : 9;
  };
  return [...issues]
    .sort((a, b) => rank(a) - rank(b) || a.number - b.number)
    .map((issue) => {
      const body = issue.body ?? "";
      const deps = new Set([...body.matchAll(DEPENDENCY)].map((match) => match[1] ?? match[2]));
      const areas = areaField ? (parseBody(fields, body)[areaField.id] ?? []) : [];
      const hasAreas = Array.isArray(areas) && areas.length > 0;
      const schema = hasAreas && areas.some((area) => area.startsWith(SCHEMA_OPTION_PREFIX));
      return [
        `#${issue.number}`,
        `p${rank(issue) === 9 ? "-" : rank(issue)}`,
        issue.title,
        `labels=${issue.labels.map((label) => label.name).join(",")}`,
        `deps=${[...deps].map((dep) => `#${dep}`).join(",") || "-"}`,
        // 欄が無い issue はチェックが読めないので「不明」とし、司令塔が本文から判断する
        `schema=${schema ? "yes" : hasAreas ? "no" : "?"}`,
        `areas=${hasAreas ? areas.join(" | ") : "?"}`,
      ].join("\t");
    });
}

function describeFields(fields) {
  return fields
    .map((field) => {
      const head = `${field.id}\t${field.type}\t${field.required ? "必須" : "任意"}\t${field.label}\t${field.description}`;
      const options = (field.options ?? []).map((option) => `\t- ${option}`);
      return [head, ...options].join("\n");
    })
    .join("\n");
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  const [command, file] = process.argv.slice(2);
  const fields = loadFields();
  try {
    if (command === "template") {
      console.log(describeFields(fields));
    } else if (command === "render") {
      process.stdout.write(renderBody(fields, JSON.parse(readFileSync(0, "utf8"))));
    } else if (command === "summarize" && file) {
      const issues = JSON.parse(readFileSync(file, "utf8"));
      if (issues.length === 0) console.log("対象 issue: なし");
      else console.log(summarize(fields, issues).join("\n"));
    } else {
      console.error("使い方: node scripts/issue-body.mjs template | render < fields.json | summarize <issues.json>");
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`issue-body: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
