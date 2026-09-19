import { useCallback, useEffect, useState } from "react";

/**
 * 配色の設定。`__root.tsx` の head に埋めたインラインスクリプトと同じ値をここでも読み書きする。
 *
 * キーと値の形を変えるときは、必ず `__root.tsx` の `themeScript` も揃えること。
 * 片方だけ変えると、初回描画だけ別の配色になってちらつく
 */
export const THEME_STORAGE_KEY = "theme";

export const THEME_PREFERENCES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
/** 実際に画面に出る配色。"system" は OS の設定を見てこのどちらかに解決する */
export type ResolvedTheme = "light" | "dark";

/**
 * 保存が無いときの設定。OS の設定に従う。
 * ボタンからは light と dark しか選べないので、ここへ戻るのは localStorage を消したときだけ
 */
export const DEFAULT_THEME: ThemePreference = "system";

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value);
}

/**
 * 保存済みの設定。読めない環境 (プライベートブラウジング等で localStorage が例外を投げる)
 * では既定の "system" として扱う。ここで落とすと配色の切り替えだけでなくヘッダー全体が壊れる
 */
export function readStoredTheme(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** 保存できない環境では黙って諦める。その場合は次回の読み込みで "system" に戻るだけ */
export function writeStoredTheme(theme: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // 保存先が使えないだけで、今表示している配色は下の applyTheme が変えている
  }
}

/** matchMedia を持たない環境 (古いブラウザ・一部のテスト環境) では「暗くない」とみなす */
function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(DARK_QUERY).matches;
}

/** 設定値を実際の見え方に解決する */
export function resolveTheme(theme: ThemePreference): ResolvedTheme {
  if (theme === "system") return systemPrefersDark() ? "dark" : "light";
  return theme;
}

/** `src/index.css` の `.dark` を html に付け外しする。配色が変わる箇所はここ 1 つだけ */
export function applyTheme(theme: ThemePreference): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", resolveTheme(theme) === "dark");
}

/**
 * 配色の設定と、その切り替え。
 *
 * 初回訪問は "system" で、OS の設定に追従し続ける。ボタンを押すと "light" か "dark" に
 * 固定され、以後 OS が変わっても動かない ("system" へ戻す操作はボタンには出さない。
 * 2 択のトグルにするため。戻したい人は localStorage の "theme" を消せばよい)。
 *
 * `theme` はマウントが済むまで null を返す。SSR では localStorage も OS の設定も読めないため、
 * サーバーで値を決め打つとハイドレーションで食い違う。呼び出し側は null の間、
 * どの状態とも言い切らない見た目を出すこと。
 *
 * 初回描画の配色そのものは `__root.tsx` のインラインスクリプトが既に付けているので、
 * ここではマウント時に付け直さない。設定を変えたときと、"system" で OS の設定が変わったときだけ触る
 */
export function useTheme(): {
  theme: ThemePreference | null;
  resolved: ResolvedTheme | null;
  setTheme: (theme: ThemePreference) => void;
} {
  const [theme, setThemeState] = useState<ThemePreference | null>(null);
  const [resolved, setResolved] = useState<ResolvedTheme | null>(null);

  useEffect(() => {
    setThemeState(readStoredTheme());
  }, []);

  useEffect(() => {
    if (theme === null) return;
    setResolved(resolveTheme(theme));

    // 固定しているときは OS の設定が変わっても従わない
    if (theme !== "system") return;
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const mql = window.matchMedia(DARK_QUERY);
    const onChange = () => {
      applyTheme("system");
      setResolved(resolveTheme("system"));
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((next: ThemePreference) => {
    // 保存より先に見た目を変えない。保存が失敗しても表示は変えたいので applyTheme は必ず呼ぶ
    writeStoredTheme(next);
    applyTheme(next);
    setThemeState(next);
  }, []);

  return { theme, resolved, setTheme };
}
