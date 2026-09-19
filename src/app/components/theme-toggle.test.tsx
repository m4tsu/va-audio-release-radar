import { render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ThemeToggle } from "@/app/components/theme-toggle";
import { THEME_STORAGE_KEY } from "@/app/hooks/use-theme";
import { LocaleContext } from "@/app/i18n";

function stubMatchMedia(prefersDark: boolean) {
  vi.stubGlobal("matchMedia", () => ({
    matches: prefersDark,
    media: "(prefers-color-scheme: dark)",
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function click(): void {
  act(() => {
    screen.getByRole("button").click();
  });
}

describe("ThemeToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    stubMatchMedia(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("押すと light と dark を往復するだけで、system には戻らない", () => {
    render(<ThemeToggle />);
    const button = screen.getByRole("button");
    // 保存が無いので既定は system。OS がライトなので見た目はライト
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("aria-pressed", "false");

    click();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(button).toHaveAttribute("aria-pressed", "true");

    click();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    // 3 状態の名残が無いこと。何度押しても system には落ちない
    click();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    click();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  test("保存が無ければ OS の設定に従う", () => {
    stubMatchMedia(true);
    render(<ThemeToggle />);
    const button = screen.getByRole("button");
    // localStorage は空。OS がダークなので押されている扱いで、押すとライトへ向かう
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveAccessibleName("ライトに切り替える");
  });

  test("ラベルは押した先を言う", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(<ThemeToggle />);
    expect(screen.getByRole("button")).toHaveAccessibleName("ライトに切り替える");
  });

  test("表示言語に追従する", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    render(
      <LocaleContext value="en">
        <ThemeToggle />
      </LocaleContext>,
    );
    expect(screen.getByRole("button")).toHaveAccessibleName("Switch to dark theme");
  });

  /**
   * アイコンは CSS で出し分ける (ハイドレーションを待たずに正しい方を出すため)。
   * 両方が DOM に居て、`dark:` バリアントで片方だけが見えることを確かめる
   */
  test("太陽と月の両方を描き、dark バリアントで出し分ける", () => {
    const { container } = render(<ThemeToggle />);
    const icons = [...container.querySelectorAll("svg")];
    expect(icons).toHaveLength(2);
    expect(icons[0]?.getAttribute("class")).toContain("dark:hidden");
    expect(icons[1]?.getAttribute("class")).toContain("dark:block");
  });

  test("localStorage が使えなくても描画も操作もできる", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("access denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("access denied");
    });

    expect(() => render(<ThemeToggle />)).not.toThrow();
    click();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    click();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
