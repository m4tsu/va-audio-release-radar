import { createContext, useContext, useMemo } from "react";
import { en } from "./en";
import { type Dictionary, ja } from "./ja";

/**
 * 型付きの辞書と `t()`。
 *
 * i18next は使わない。対応は 2 言語だけで、言語は SSR で確定させてから描くので、
 * 非同期の初期化とハイドレーションの辻褄合わせを抱える価値がない (設計の決定)。
 *
 * キー構造の正は `ja.ts`。`en.ts` は下の `Translations` 型で同じ形を強制されるので、
 * ja にキーを足して en を直し忘れるとコンパイルが落ちる
 */

export const LOCALES = ["ja", "en"] as const;
export type Locale = (typeof LOCALES)[number];
/** cookie が無く Accept-Language も読めないときの言語。SEO の対象が日本語クエリなので日本語 */
export const DEFAULT_LOCALE: Locale = "ja";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * 複数形が要る言語のための値の形。日本語は数で語形が変わらないので常に文字列 1 つで足りる。
 * `count` を渡したときだけ選ばれ、1 (と -1) なら `one`、それ以外は `other`
 */
export type PluralForms = { one: string; other: string };
type Leaf = string | PluralForms;

/**
 * ja と同じキー構造を強制する型。値は文字列でも複数形の組でもよい。
 * `en.ts` はこの型を付けて宣言するので、キーの過不足がコンパイルエラーになる
 */
export type Translations<T = Dictionary> = {
  [K in keyof T]: T[K] extends string ? Leaf : Translations<T[K]>;
};

/** "home.feedTitle" のようなドット記法のキー。ja に無いキーはここで弾かれる */
type DotPaths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${DotPaths<T[K]>}`;
}[keyof T & string];

export type TKey = DotPaths<Dictionary>;

/** キーの指す ja の値 (文字列リテラル型)。埋め込み変数を取り出すのに使う */
type ValueAt<T, P extends string> = P extends `${infer K}.${infer Rest}`
  ? K extends keyof T
    ? ValueAt<T[K], Rest>
    : never
  : P extends keyof T
    ? T[P]
    : never;

/** "{{count}} 作品" から "count" を取り出す。渡し忘れと綴り違いをコンパイル時に落とす */
type Vars<S extends string> = S extends `${string}{{${infer V}}}${infer Rest}`
  ? V | Vars<Rest>
  : never;

type VarsOf<K extends TKey> = Vars<Extract<ValueAt<Dictionary, K>, string>>;

export type TranslateParams = Record<string, string | number>;

/** 埋め込みの無いキーでは第 2 引数を受け付けない。あるキーでは必須にする */
type TranslateArgs<K extends TKey> = [VarsOf<K>] extends [never]
  ? []
  : [params: Record<VarsOf<K>, string | number>];

export type TranslateFn = <K extends TKey>(key: K, ...args: TranslateArgs<K>) => string;

/** 埋め込みの無いキーだけ。引数なしで引ける文言を props で受け取る部品が使う */
export type PlainTKey = { [K in TKey]: [VarsOf<K>] extends [never] ? K : never }[TKey];

const DICTIONARIES: Record<Locale, Translations> = { ja, en };

function isPluralForms(value: unknown): value is PluralForms {
  if (typeof value !== "object" || value === null) return false;
  const forms = value as Partial<PluralForms>;
  return typeof forms.one === "string" && typeof forms.other === "string";
}

function lookup(dictionary: Translations, key: string): Leaf | undefined {
  let node: unknown = dictionary;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node === "string") return node;
  return isPluralForms(node) ? node : undefined;
}

function pickPlural(forms: PluralForms, params: TranslateParams | undefined): string {
  const count = params?.count;
  return typeof count === "number" && Math.abs(count) === 1 ? forms.one : forms.other;
}

/** 値が無い埋め込みは `{{name}}` のまま残す。空文字にすると文が不自然に途切れて気づけない */
function interpolate(template: string, params: TranslateParams | undefined): string {
  if (params === undefined) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}

/**
 * 辞書を引いて文言を作る。型の上では起きないはずだが、英語辞書に取りこぼしがあっても
 * キー文字列を画面に出さないよう日本語に落とす (欠落は英語の未訳として見える)
 */
function translateRaw(locale: Locale, key: string, params?: TranslateParams): string {
  const leaf = lookup(DICTIONARIES[locale], key) ?? lookup(ja, key);
  if (leaf === undefined) return key;
  return interpolate(typeof leaf === "string" ? leaf : pickPlural(leaf, params), params);
}

/**
 * 言語を引数で受け取る `t`。React の外 (`head()` やフォーマッタ) から使う。
 * 実体は上の `translateRaw` で、ここではキーと埋め込み変数の型だけを被せている
 */
export const translate = translateRaw as <K extends TKey>(
  locale: Locale,
  key: K,
  ...args: TranslateArgs<K>
) => string;

/** 言語を固定した `t`。コンポーネントからは下の `useT()` でこれを受け取る */
export function createTranslator(locale: Locale): TranslateFn {
  return ((key: string, params?: TranslateParams) =>
    translateRaw(locale, key, params)) as TranslateFn;
}

/**
 * 表示言語。`__root.tsx` が SSR で解決した値をここに流す。
 * 既定値を日本語にしてあるのは、Provider の外で描かれたものが素の状態で壊れないようにするため
 */
export const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useT(): TranslateFn {
  const locale = useLocale();
  return useMemo(() => createTranslator(locale), [locale]);
}
