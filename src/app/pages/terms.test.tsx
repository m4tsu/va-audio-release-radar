import { screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { TermsPage } from "@/app/pages/terms";
import { renderWithLocale } from "@/app/test/render";

describe("TermsPage", () => {
  test("見出しと制定日と本文の条を出す", () => {
    renderWithLocale(<TermsPage contactUrl={null} />);

    expect(screen.getByRole("heading", { level: 1, name: "利用規約" })).toBeInTheDocument();
    expect(screen.getByText("制定日: 2026年9月19日")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "第1条 (本規約の適用)" }),
    ).toBeInTheDocument();
  });

  test("英語表示では本文も英語になる", () => {
    renderWithLocale(<TermsPage contactUrl={null} />, "en");

    expect(screen.getByRole("heading", { level: 1, name: "Terms of Service" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "1. Scope" })).toBeInTheDocument();
  });

  test("窓口が無ければリンクを出さず、案内の文だけにする", () => {
    renderWithLocale(<TermsPage contactUrl={null} />);

    expect(
      screen.getByText(
        "本規約および本サービスに関するお問い合わせ窓口は、本サービス上で案内します。",
      ),
    ).toBeInTheDocument();
  });

  /** `mailto:` はアドレスだけを見せる */
  test("窓口があればリンクにし、mailto はアドレスだけを出す", () => {
    renderWithLocale(<TermsPage contactUrl="mailto:example@example.com" />);

    const link = screen.getByRole("link", { name: "example@example.com" });
    expect(link).toHaveAttribute("href", "mailto:example@example.com");
  });
});
