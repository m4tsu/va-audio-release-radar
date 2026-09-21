import { screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { LocaleContext } from "@/app/i18n";
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

  /** `/contact` を直接開いたとき。リンクから開いた場合との違いを 1 か所で見る */
  test("種別と対象の指定が無ければ、既定の種別と空の本文で始まる", () => {
    renderWithLocale(<ContactPage turnstileSiteKey="test-site-key" contactUrl={null} />);

    expect(screen.getByLabelText("種別")).toHaveValue("request");
    expect(screen.getByLabelText("本文")).toHaveValue("");
    expect(screen.queryByText(/別名義の申し出には根拠を書いてください/)).not.toBeInTheDocument();
  });

  test("訂正の申し出として開くと、種別が選ばれ本文の先頭に対象の URL が入る", () => {
    renderWithLocale(
      <ContactPage
        turnstileSiteKey="test-site-key"
        contactUrl={null}
        defaultKind="correction"
        targetUrl="https://example.test/voice-actors/alpha"
      />,
    );

    expect(screen.getByLabelText("種別")).toHaveValue("correction");
    expect(screen.getByLabelText("本文")).toHaveValue(
      "https://example.test/voice-actors/alpha\n\n",
    );
    expect(screen.getByText(/別名義の申し出には根拠を書いてください/)).toBeInTheDocument();
  });

  /**
   * フッターの「お問い合わせ」は `/contact` 自身にも出る。訂正の申し出の画面から押すと
   * 画面は留まったまま欄だけが消えるので、入力欄も素の状態に戻る必要がある
   */
  test("対象の指定が外れたら、種別と本文も既定に戻る", () => {
    const { rerender } = renderWithLocale(
      <ContactPage
        turnstileSiteKey="test-site-key"
        contactUrl={null}
        defaultKind="correction"
        targetUrl="https://example.test/voice-actors/alpha"
      />,
    );

    rerender(
      <LocaleContext value="ja">
        <ContactPage turnstileSiteKey="test-site-key" contactUrl={null} />
      </LocaleContext>,
    );

    expect(screen.getByLabelText("種別")).toHaveValue("request");
    expect(screen.getByLabelText("本文")).toHaveValue("");
  });

  test("送信できるときは外部の窓口の案内を出さない", () => {
    renderWithLocale(
      <ContactPage turnstileSiteKey="test-site-key" contactUrl="mailto:example@example.com" />,
    );

    expect(screen.queryByText("現在この画面からは送信できません。")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "example@example.com" })).not.toBeInTheDocument();
  });
});
