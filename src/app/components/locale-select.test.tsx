import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { LocaleSelect } from "@/app/components/locale-select";
import { LocaleContext } from "@/app/i18n";

/**
 * cookie の書き込みは `@tanstack/react-start` を引き込むモジュールにある。
 * ここで見たいのは「何を出すか」だけなので、その 1 関数だけ差し替える
 */
vi.mock("@/app/server-fns/locale", () => ({ writeLocaleCookie: vi.fn() }));

describe("LocaleSelect", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("いま選ばれている言語を、その言語自身の表記で出す", () => {
    render(<LocaleSelect />);
    expect(screen.getByRole("combobox")).toHaveTextContent("日本語");
  });

  test("英語のときは English を出す", () => {
    render(
      <LocaleContext value="en">
        <LocaleSelect />
      </LocaleContext>,
    );
    expect(screen.getByRole("combobox")).toHaveTextContent("English");
    expect(screen.getByRole("combobox")).toHaveAccessibleName("Display language: English");
  });

  /** 画面には言語名だけを出すので、「表示言語」という役割は読み上げ側で補う */
  test("読み上げ名に役割と今の言語の両方が入る", () => {
    render(<LocaleSelect />);
    expect(screen.getByRole("combobox")).toHaveAccessibleName("表示言語: 日本語");
  });

  /** ネイティブの `<select>` に戻ると、ダークで選択肢が読めなくなる (回帰の見張り) */
  test("ネイティブの select は使わない", () => {
    const { container } = render(<LocaleSelect />);
    expect(container.querySelector("select")).toBeNull();
  });
});
