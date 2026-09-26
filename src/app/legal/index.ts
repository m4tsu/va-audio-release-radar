import { createTranslator, type Locale } from "@/app/i18n";

/**
 * 利用規約・プライバシーポリシーの本文の形。
 *
 * 本文は `i18n/ja.ts` の辞書には入れない。辞書は 1 キー 1 文の UI 文言のためのもので、
 * 条ごとに段落と箇条書きが並ぶ文書を平らなキーに割ると、条の順序と対応関係が
 * キー名にしか残らなくなる。ここでは言語ごとに同じ構造の配列を持ち、
 * `legal.test.ts` が条の id と並びが両言語で一致することを確かめる。
 *
 * 文中でサービスの仕組みに触れるときは、リポジトリで確かめられることだけを書く
 * (何をブラウザに保存するか、何をサーバーへ送るか、画像をどこから読むか)。
 */

/**
 * 利用規約とプライバシーポリシーに出す運営者の表記。両文書の本文はここから差し込む。
 * 特定商取引法に基づく表示を置かない理由は `docs/decisions/0019-no-tokushoho-notice.md`
 */
export const OPERATOR_NAME: Record<Locale, string> = {
  ja: `${createTranslator("ja")("app.name")}運営`,
  en: `${createTranslator("en")("app.name")} Team`,
};

export type LegalBlock =
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  /**
   * 問い合わせ窓口。`text` の後ろに必ずお問い合わせ画面 (`/contact`) へのリンクを出す。
   * `CONTACT_URL` が設定されていれば、続けて `withExternal` と外部の窓口へのリンクを出す
   */
  | { type: "contact"; text: string; withExternal: string };

export type LegalSection = {
  /** 見出しのアンカーと、言語間の対応付けに使う。言語が変わっても同じ値 */
  id: string;
  heading: string;
  blocks: LegalBlock[];
};

export type LegalDocument = {
  /** 制定日 (ISO 8601 の日付部分)。本文を実質的に変えたら更新する */
  effectiveDate: string;
  sections: LegalSection[];
};

export type LocalizedLegalDocument = Record<Locale, LegalDocument>;
