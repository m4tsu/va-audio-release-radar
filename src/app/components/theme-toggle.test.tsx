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

  test("押すたびに 3 状態を順に回り、localStorage に残る", () => {
    render(<ThemeToggle />);
    const button = screen.getByRole("button");
    // 既定は system。1 回目で light に進む
    expect(button).toBeEnabled();

    click();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    click();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    click();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
    // OS はライトなので system でライトに戻る
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    click();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  test("いまの状態と次の状態がラベルに出る", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(<ThemeToggle />);
    expect(screen.getByRole("button")).toHaveAccessibleName(
      "配色: ダーク (押すと OS に合わせる に切り替わる)",
    );
  });

  test("表示言語に追従する", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    render(
      <LocaleContext value="en">
        <ThemeToggle />
      </LocaleContext>,
    );
    expect(screen.getByRole("button")).toHaveAccessibleName("Theme: Light (switch to Dark)");
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
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    click();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
