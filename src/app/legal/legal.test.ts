import { describe, expect, test } from "vitest";
import { createTranslator, LOCALES } from "@/app/i18n";
import {
  type LegalBlock,
  type LegalDocument,
  type LocalizedLegalDocument,
  OPERATOR_NAME,
} from "./index";
import { privacy } from "./privacy";
import { terms } from "./terms";

const DOCUMENTS: Record<string, LocalizedLegalDocument> = { terms, privacy };

function blockTexts(block: LegalBlock): string[] {
  switch (block.type) {
    case "paragraph":
      return [block.text];
    case "list":
      return block.items;
    case "contact":
      return [block.text, block.withExternal];
  }
}

function texts(document: LegalDocument): string[] {
  return document.sections.flatMap((section) => [
    section.heading,
    ...section.blocks.flatMap(blockTexts),
  ]);
}

describe.each(Object.entries(DOCUMENTS))("%s", (_name, document) => {
  /** 条の追加や並べ替えを片方の言語だけで済ませると、アンカーと対応関係がずれる */
  test("条の id と並びが全言語で一致する", () => {
    const ids = LOCALES.map((locale) => document[locale].sections.map((section) => section.id));
    for (const other of ids.slice(1)) expect(other).toEqual(ids[0]);
  });

  test("条の id が重複しない", () => {
    for (const locale of LOCALES) {
      const ids = document[locale].sections.map((section) => section.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  test("制定日が全言語で同じ ISO 日付", () => {
    const dates = LOCALES.map((locale) => document[locale].effectiveDate);
    for (const date of dates) expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Set(dates).size).toBe(1);
  });

  test("空の文が無い", () => {
    for (const locale of LOCALES) {
      for (const text of texts(document[locale])) expect(text.trim().length).toBeGreaterThan(0);
    }
  });

  /**
   * サービス名は辞書 (`i18n/ja.ts` の `app.name`) が正で、本文はそれをベタ書きしている。
   * 名前を変えたときに本文の直し漏れを見つける
   */
  test("本文がサービス名を辞書と同じ綴りで書いている", () => {
    for (const locale of LOCALES) {
      const name = createTranslator(locale)("app.name");
      expect(texts(document[locale]).some((text) => text.includes(name))).toBe(true);
    }
  });

  /** 「運営者」とだけ書くと誰が運営しているか特定できない */
  test("本文が運営者を表記で名指ししている", () => {
    for (const locale of LOCALES) {
      expect(texts(document[locale]).some((text) => text.includes(OPERATOR_NAME[locale]))).toBe(
        true,
      );
    }
  });

  /** 窓口の案内は 1 箇所。無いと連絡手段が消え、2 つあると `CONTACT_URL` の出し分けが二重になる */
  test("問い合わせ窓口の段落が 1 つだけある", () => {
    for (const locale of LOCALES) {
      const contacts = document[locale].sections.flatMap((section) =>
        section.blocks.filter((block) => block.type === "contact"),
      );
      expect(contacts).toHaveLength(1);
    }
  });
});
