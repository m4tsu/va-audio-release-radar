import { screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { PrivacyPage } from "@/app/pages/privacy";
import { renderWithLocale } from "@/app/test/render";

describe("PrivacyPage", () => {
  test("見出しと制定日と本文の節を出す", () => {
    renderWithLocale(<PrivacyPage contactUrl={null} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "プライバシーポリシー" }),
    ).toBeInTheDocument();
    expect(screen.getByText("制定日: 2026年9月25日")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "1. 基本方針" })).toBeInTheDocument();
  });

  test("英語表示では本文も英語になる", () => {
    renderWithLocale(<PrivacyPage contactUrl={null} />, "en");

    expect(screen.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "1. Overview" })).toBeInTheDocument();
  });

  test("窓口があればリンクにする", () => {
    renderWithLocale(<PrivacyPage contactUrl="https://example.com/contact" />);

    expect(screen.getByRole("link", { name: "https://example.com/contact" })).toHaveAttribute(
      "href",
      "https://example.com/contact",
    );
  });

  /** 外部の窓口が無くても、サイト内の窓口は必ず案内する */
  test("外部の窓口が無くてもお問い合わせ画面へのリンクを出す", () => {
    renderWithLocale(<PrivacyPage contactUrl={null} />);

    expect(screen.getByRole("link", { name: "お問い合わせフォーム" })).toHaveAttribute(
      "href",
      "/contact",
    );
  });

  /** 送った内容の行き先と、この画面が読み込む外部のものを本文に書いておく */
  test("問い合わせの保存と bot 対策の読み込みに触れている", () => {
    renderWithLocale(<PrivacyPage contactUrl={null} />);

    expect(screen.getByText(/お問い合わせを送信すると/)).toBeInTheDocument();
    expect(screen.getByText(/Cloudflare Turnstile/)).toBeInTheDocument();
  });
});
