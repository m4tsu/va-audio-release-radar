import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  nextThemePreference,
  readStoredTheme,
  THEME_STORAGE_KEY,
  useTheme,
  writeStoredTheme,
} from "./use-theme";

/**
 * jsdom には matchMedia が無いので、OS の設定を差し替えられる形で立てる。
 * 「system のときだけ OS の変更に追従する」ことをここで確かめるため、
 * 登録された listener の数も見られるようにしておく
 */
function stubMatchMedia(prefersDark: boolean) {
  const listeners = new Set<() => void>();
  let matches = prefersDark;
  const mql = {
    get matches() {
      return matches;
    },
    media: "(prefers-color-scheme: dark)",
    addEventListener: (_type: string, listener: () => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: () => void) => {
      listeners.delete(listener);
    },
  };
  vi.stubGlobal("matchMedia", () => mql);
  return {
    listenerCount: () => listeners.size,
    setPrefersDark(next: boolean) {
      matches = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

describe("useTheme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("マウントが済むまで状態を確定させない (SSR とハイドレーションを揃えるため)", () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    // renderHook は effect まで流すので、ここで見えるのはマウント後の値
    expect(result.current.theme).toBe("system");
    expect(result.current.resolved).toBe("light");
  });

  test("保存済みの設定を読む", () => {
    stubMatchMedia(false);
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
    expect(result.current.resolved).toBe("dark");
  });

  test("light → dark → system → light と 3 状態を回り、html の .dark が追従する", () => {
    stubMatchMedia(true); // OS はダーク。system に戻したときにダークへ戻ることを見る
    const { result } = renderHook(() => useTheme());

    act(() => result.current.setTheme("light"));
    expect(result.current.theme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");

    act(() => result.current.setTheme(nextThemePreference("light")));
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    act(() => result.current.setTheme(nextThemePreference("dark")));
    expect(result.current.theme).toBe("system");
    // OS がダークなので system でもダークのまま
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(result.current.resolved).toBe("dark");

    expect(nextThemePreference("system")).toBe("light");
  });

  test("system のときだけ OS の設定変更に追従する", () => {
    const media = stubMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("system");

    act(() => media.setPrefersDark(true));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(result.current.resolved).toBe("dark");

    // 固定したら OS が変わっても動かない。listener も外れる
    act(() => result.current.setTheme("light"));
    expect(media.listenerCount()).toBe(0);
    act(() => media.setPrefersDark(false));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    act(() => media.setPrefersDark(true));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  test("localStorage が使えなくても落ちず、表示だけは切り替わる", () => {
    stubMatchMedia(false);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("access denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("access denied");
    });

    expect(readStoredTheme()).toBe("system");
    expect(() => {
      writeStoredTheme("dark");
    }).not.toThrow();

    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("system");

    act(() => result.current.setTheme("dark"));
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  test("matchMedia を持たない環境でも system をライトとして扱う", () => {
    vi.stubGlobal("matchMedia", undefined);
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("system");
    expect(result.current.resolved).toBe("light");
  });
});
