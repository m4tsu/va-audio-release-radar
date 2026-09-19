import { createServerFn } from "@tanstack/react-start";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/app/i18n";

/**
 * 表示言語の解決 (設計の決定)。
 *
 * 順に cookie `locale` → `Accept-Language` → 既定の日本語。URL には言語を入れないので、
 * 同じ URL が読み手によって日本語にも英語にもなる。これを SSR で確定させないと、
 * 日本語で描いたものが直後に英語へ差し替わってちらつく
 */

export const LOCALE_COOKIE = "locale";
/** 1 年。何度も選び直させないための保持期間で、短くする理由が特に無い */
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * cookie 文字列から言語を読む。サーバーの `Cookie` ヘッダも、
 * ブラウザの `document.cookie` も同じ "a=1; b=2" の形なので 1 つで足りる
 */
export function localeFromCookieHeader(header: string | null | undefined): Locale | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== LOCALE_COOKIE) continue;
    const value = part.slice(separator + 1).trim();
    return isLocale(value) ? value : undefined;
  }
  return undefined;
}

/**
 * `Accept-Language` から言語を決める。
 *
 * q 値の大きい順に見て、対応している言語が最初に現れたものを採る。
 * "ja-JP" のような地域付きは先頭の部分だけを見る。"*" は「何でもよい」なので既定に倒す
 */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | undefined {
  if (!header) return undefined;

  const entries = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const quality = params
        .map((param) => /^q=([\d.]+)$/i.exec(param.trim()))
        .find((match) => match !== null);
      return { tag: (tag ?? "").trim().toLowerCase(), quality: quality ? Number(quality[1]) : 1 };
    })
    .filter((entry) => entry.tag.length > 0 && Number.isFinite(entry.quality) && entry.quality > 0)
    // 同じ q 値の並びは書かれた順を保つ (Array.sort は安定)
    .sort((a, b) => b.quality - a.quality);

  for (const entry of entries) {
    if (entry.tag === "*") return DEFAULT_LOCALE;
    const base = entry.tag.split("-")[0];
    if (isLocale(base)) return base;
  }
  return undefined;
}

export function resolveLocaleFromHeaders(headers: Headers): Locale {
  return (
    localeFromCookieHeader(headers.get("cookie")) ??
    localeFromAcceptLanguage(headers.get("accept-language")) ??
    DEFAULT_LOCALE
  );
}

const resolveLocaleFn = createServerFn({ method: "GET" }).handler(async () => {
  const { getRequest } = await import("@tanstack/react-start/server");
  return resolveLocaleFromHeaders(getRequest().headers);
});

/**
 * ブラウザ側は SSR が決めた結果をそのまま引き継ぐ。cookie は同じものが読め、
 * 無ければ `<html lang>` に解決済みの言語が入っている。RPC を投げる必要はない
 */
function localeOnClient(): Locale {
  const fromCookie = localeFromCookieHeader(document.cookie);
  if (fromCookie) return fromCookie;
  const lang = document.documentElement.lang;
  return isLocale(lang) ? lang : DEFAULT_LOCALE;
}

/** ルートの `beforeLoad` から呼ぶ。SSR では実リクエストを見て、ブラウザでは cookie を見る */
export async function resolveLocaleForRoute(): Promise<Locale> {
  if (typeof document !== "undefined") return localeOnClient();
  return resolveLocaleFn();
}

/**
 * 選んだ言語を cookie に書く。
 *
 * `HttpOnly` は付けない。切り替えはブラウザ上の操作で、そこから書けないと
 * 言語を変えるためだけに server function を 1 つ増やすことになる。
 * 値は "ja" | "en" しか入らないので、cookie に出す前の符号化も要らない
 */
export function writeLocaleCookie(locale: Locale): void {
  if (typeof document === "undefined") return;
  // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API は Safari が未対応。書くのはこの 1 箇所だけで、値も "ja" | "en" に限られる
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
}
