import { screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { TermsPage } from "@/app/pages/terms";
import { renderWithLocale } from "@/app/test/render";

describe("TermsPage", () => {
  test("見出しと制定日と本文の条を出す", () => {
    renderWithLocale(<TermsPage contactUrl={null} />);

    expect(screen.getByRole("heading", { level: 1, name: "利用規約" })).toBeInTheDocument();
    expect(screen.getByText("制定日: 2026年9月21日")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "第1条 (本規約の適用)" }),
    ).toBeInTheDocument();
  });

  test("英語表示では本文も英語になる", () => {
    renderWithLocale(<TermsPage contactUrl={null} />, "en");

    expect(screen.getByRole("heading", { level: 1, name: "Terms of Service" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "1. Scope" })).toBeInTheDocument();
  });

  /** 外部の窓口が無くても、サイト内の窓口は必ず案内する */
  test("外部の窓口が無くてもお問い合わせ画面へのリンクを出す", () => {
    renderWithLocale(<TermsPage contactUrl={null} />);

    expect(screen.getByRole("link", { name: "お問い合わせフォーム" })).toHaveAttribute(
      "href",
      "/contact",
    );
    expect(screen.queryByRole("link", { name: /example/ })).not.toBeInTheDocument();
  });

  /** `mailto:` はアドレスだけを見せる */
  test("外部の窓口があれば併せてリンクにし、mailto はアドレスだけを出す", () => {
    renderWithLocale(<TermsPage contactUrl="mailto:example@example.com" />);

    expect(screen.getByRole("link", { name: "お問い合わせフォーム" })).toHaveAttribute(
      "href",
      "/contact",
    );
    expect(screen.getByRole("link", { name: "example@example.com" })).toHaveAttribute(
      "href",
      "mailto:example@example.com",
    );
  });
});
