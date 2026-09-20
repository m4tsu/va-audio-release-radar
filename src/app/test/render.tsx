import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { type Locale, LocaleContext } from "@/app/i18n";

/**
 * 表示言語を決めて描く。
 *
 * 既定の日本語は `LocaleContext` の初期値なので巻かなくても描けるが、
 * 英語のテストで Provider を書き忘れると日本語のまま通ってしまう。
 * 言語を必ず引数で言わせるためにこの 1 本を通す
 */
export function renderWithLocale(ui: ReactElement, locale: Locale = "ja") {
  return render(<LocaleContext value={locale}>{ui}</LocaleContext>);
}
