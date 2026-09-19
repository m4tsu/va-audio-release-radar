import { describe, expect, test } from "vitest";
import { LOCALES } from "@/app/i18n";
import type { LegalBlock, LegalDocument, LocalizedLegalDocument } from "./index";
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
      return [block.withUrl, block.withoutUrl];
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
