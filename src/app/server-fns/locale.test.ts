import { describe, expect, test } from "vitest";
import {
  localeFromAcceptLanguage,
  localeFromCookieHeader,
  resolveLocaleFromHeaders,
} from "./locale";

describe("localeFromCookieHeader", () => {
  test("locale の値を読む", () => {
    expect(localeFromCookieHeader("locale=en")).toBe("en");
    expect(localeFromCookieHeader("theme=dark; locale=ja; other=1")).toBe("ja");
  });

  test("対応外の値と、他の cookie に紛れた似た名前は拾わない", () => {
    expect(localeFromCookieHeader("locale=fr")).toBeUndefined();
    expect(localeFromCookieHeader("mylocale=en")).toBeUndefined();
    expect(localeFromCookieHeader("")).toBeUndefined();
    expect(localeFromCookieHeader(null)).toBeUndefined();
  });
});

describe("localeFromAcceptLanguage", () => {
  test("先頭の言語を採る", () => {
    expect(localeFromAcceptLanguage("en-US,en;q=0.9")).toBe("en");
    expect(localeFromAcceptLanguage("ja,en-US;q=0.9")).toBe("ja");
  });

  test("q 値の大きい方を採る", () => {
    expect(localeFromAcceptLanguage("de;q=0.5,en;q=0.7,ja;q=0.9")).toBe("ja");
    expect(localeFromAcceptLanguage("ja;q=0.3,en;q=0.8")).toBe("en");
  });

  test("対応していない言語は飛ばす", () => {
    expect(localeFromAcceptLanguage("fr-FR,de;q=0.8")).toBeUndefined();
    expect(localeFromAcceptLanguage("fr-FR,de;q=0.8,en;q=0.1")).toBe("en");
  });

  test("q=0 は「要らない」なので採らない", () => {
    expect(localeFromAcceptLanguage("en;q=0,ja;q=0.5")).toBe("ja");
  });

  test("* は既定に倒す", () => {
    expect(localeFromAcceptLanguage("*")).toBe("ja");
  });

  test("読めない値では決めない", () => {
    expect(localeFromAcceptLanguage("")).toBeUndefined();
    expect(localeFromAcceptLanguage(null)).toBeUndefined();
  });
});

describe("resolveLocaleFromHeaders", () => {
  test("cookie が Accept-Language より強い", () => {
    const headers = new Headers({ cookie: "locale=ja", "accept-language": "en-US,en;q=0.9" });
    expect(resolveLocaleFromHeaders(headers)).toBe("ja");
  });

  test("cookie が無ければ Accept-Language を見る", () => {
    expect(resolveLocaleFromHeaders(new Headers({ "accept-language": "en-US" }))).toBe("en");
  });

  test("どちらも無ければ日本語", () => {
    expect(resolveLocaleFromHeaders(new Headers())).toBe("ja");
  });
});
