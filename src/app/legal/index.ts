import type { Locale } from "@/app/i18n";

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

export type LegalBlock =
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  /**
   * 問い合わせ窓口。`CONTACT_URL` があれば `withUrl` の後ろにリンクを出し、
   * 無ければ `withoutUrl` だけを出す
   */
  | { type: "contact"; withUrl: string; withoutUrl: string };

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
