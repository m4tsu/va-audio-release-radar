import { screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ContactPage } from "@/app/pages/contact";
import { renderWithLocale } from "@/app/test/render";

/** 送信は inquiry-form.test.tsx が見る。ここでは呼び先を塞ぐだけ */
vi.mock("@/app/server-fns/inquiries", () => ({ submitInquiryFn: vi.fn(async () => undefined) }));

describe("ContactPage", () => {
  test("見出しと入力欄を出す", () => {
    renderWithLocale(<ContactPage turnstileSiteKey="test-site-key" contactUrl={null} />);

    expect(screen.getByRole("heading", { level: 1, name: "お問い合わせ" })).toBeInTheDocument();
    expect(screen.getByLabelText("本文")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "送信する" })).toBeInTheDocument();
  });

  test("英語表示では文言も英語になる", () => {
    renderWithLocale(<ContactPage turnstileSiteKey="test-site-key" contactUrl={null} />, "en");

    expect(screen.getByRole("heading", { level: 1, name: "Contact" })).toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toBeInTheDocument();
  });

  /** 鍵が置かれていない環境。入力欄は出したまま、送れないことを先に言う */
  test("bot 対策の設定が無ければ送信できないことを出す", () => {
    renderWithLocale(<ContactPage turnstileSiteKey={null} contactUrl={null} />);

    expect(screen.getByText("現在この画面からは送信できません。")).toBeInTheDocument();
    expect(screen.getByLabelText("本文")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "送信する" })).toBeDisabled();
  });

  test("送信できないときに外部の窓口があればそちらへ案内する", () => {
    renderWithLocale(
      <ContactPage turnstileSiteKey={null} contactUrl="mailto:example@example.com" />,
    );

    expect(screen.getByRole("link", { name: "example@example.com" })).toHaveAttribute(
      "href",
      "mailto:example@example.com",
    );
  });

  test("送信できるときは外部の窓口の案内を出さない", () => {
    renderWithLocale(
      <ContactPage turnstileSiteKey="test-site-key" contactUrl="mailto:example@example.com" />,
    );

    expect(screen.queryByText("現在この画面からは送信できません。")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "example@example.com" })).not.toBeInTheDocument();
  });
});
