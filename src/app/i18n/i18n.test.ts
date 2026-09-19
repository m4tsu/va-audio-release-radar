import { describe, expect, test } from "vitest";
import { en } from "./en";
import { createTranslator, isLocale, LOCALES, translate } from "./index";
import { ja } from "./ja";

type Node = Record<string, unknown>;

/** 辞書を "a.b.c" → 値 の平らな表に潰す。複数形の組は 1 つの葉として扱う */
function flatten(node: Node, prefix = ""): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      out.set(path, [value]);
      continue;
    }
    const child = value as Node;
    if (typeof child.one === "string" && typeof child.other === "string") {
      out.set(path, [child.one, child.other]);
      continue;
    }
    for (const [childPath, forms] of flatten(child, path)) out.set(childPath, forms);
  }
  return out;
}

function variablesIn(template: string): string[] {
  return [...template.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1] ?? "").sort();
}

const jaFlat = flatten(ja as unknown as Node);
const enFlat = flatten(en as unknown as Node);

describe("辞書", () => {
  /** キーの過不足は型でも落ちるが、型を緩めたときに気づけるようここでも見る */
  test("ja と en のキーが一致する", () => {
    expect([...enFlat.keys()].sort()).toEqual([...jaFlat.keys()].sort());
  });

  /**
   * 埋め込み変数の綴りが言語間でずれると、片方の言語でだけ "{{count}}" が
   * 生のまま画面に出る。型では追えないのでここで突き合わせる
   */
  test("埋め込み変数が ja と en で一致する (複数形の各形も同じ)", () => {
    for (const [key, jaForms] of jaFlat) {
      const expected = variablesIn(jaForms[0] ?? "");
      for (const form of enFlat.get(key) ?? []) {
        expect({ key, vars: variablesIn(form) }).toEqual({ key, vars: expected });
      }
    }
  });

  test("空の文言が無い", () => {
    for (const [key, forms] of [...jaFlat, ...enFlat]) {
      for (const form of forms)
        expect({ key, empty: form.trim().length === 0 }).toEqual({
          key,
          empty: false,
        });
    }
  });
});

describe("translate", () => {
  test("ドット記法で引ける", () => {
    expect(translate("ja", "nav.home")).toBe("ホーム");
    expect(translate("en", "nav.home")).toBe("Home");
  });

  test("変数を埋め込む", () => {
    expect(translate("ja", "search.noResults", { query: "上田" })).toBe(
      "「上田」に一致する声優は見つかりませんでした。",
    );
    expect(translate("en", "actor.title", { name: "Reina Ueda" })).toBe(
      "Audio works by Reina Ueda",
    );
  });

  test("英語は count で単数・複数を選ぶ。日本語は 1 つの文言のまま", () => {
    expect(translate("en", "common.worksCount", { count: 1 })).toBe("1 work");
    expect(translate("en", "common.worksCount", { count: 12 })).toBe("12 works");
    expect(translate("en", "common.worksCount", { count: 0 })).toBe("0 works");
    expect(translate("ja", "common.worksCount", { count: 1 })).toBe("1 作品");
  });

  test("シーズンの語順が言語で入れ替わる", () => {
    expect(
      translate("ja", "season.label", { year: 2026, season: translate("ja", "season.fall") }),
    ).toBe("2026 年秋");
    expect(
      translate("en", "season.label", { year: 2026, season: translate("en", "season.fall") }),
    ).toBe("Fall 2026");
  });

  /** 英語辞書に穴が空いても、キー文字列が画面に出るより日本語が出る方がまし */
  test("辞書に無いキーは日本語に落ち、それも無ければキーをそのまま返す", () => {
    const partial = translate as unknown as (
      locale: "ja" | "en",
      key: string,
      params?: Record<string, string | number>,
    ) => string;
    expect(partial("en", "nav.nothing.here")).toBe("nav.nothing.here");
  });

  /** 値を渡し忘れたら空白にせず印を残す。文が途切れるより気づきやすい */
  test("値の無い埋め込みはそのまま残る", () => {
    const partial = translate as unknown as (
      locale: "ja" | "en",
      key: string,
      params?: Record<string, string | number>,
    ) => string;
    expect(partial("ja", "actor.title", {})).toBe("{{name}}の音声作品");
  });
});

describe("createTranslator", () => {
  test("言語を固定した t を返す", () => {
    const t = createTranslator("en");
    expect(t("nav.following")).toBe("Following");
  });
});

describe("isLocale", () => {
  test("対応している言語だけを通す", () => {
    for (const locale of LOCALES) expect(isLocale(locale)).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale("")).toBe(false);
  });
});
