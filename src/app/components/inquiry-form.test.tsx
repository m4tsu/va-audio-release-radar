import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { InquiryForm } from "@/app/components/inquiry-form";
import { renderWithLocale } from "@/app/test/render";
import { INQUIRY_BODY_MAX_LENGTH, INQUIRY_CONTACT_MAX_LENGTH } from "@/domain/types";

const submitInquiryFn = vi.fn<(input: unknown) => Promise<unknown>>(async () => undefined);
vi.mock("@/app/server-fns/inquiries", () => ({
  submitInquiryFn: (input: unknown) => submitInquiryFn(input),
}));

/**
 * Cloudflare の widget は jsdom では読み込めない。`window.turnstile` は
 * スクリプトが置く外部の口なので、ここだけを差し替えて通った状態を作る
 */
const turnstile = {
  render: vi.fn((_container: HTMLElement, options: { callback: (token: string) => void }) => {
    options.callback("test-token");
    return "widget-1";
  }),
  reset: vi.fn(),
  remove: vi.fn(),
};

const SITE_KEY = "test-site-key";

beforeEach(() => {
  submitInquiryFn.mockReset();
  submitInquiryFn.mockResolvedValue(undefined);
  turnstile.render.mockClear();
  turnstile.reset.mockClear();
  turnstile.remove.mockClear();
  vi.stubGlobal("turnstile", turnstile);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** widget が通り、トークンが手に入るまで待つ */
async function renderReady(siteKey: string | null = SITE_KEY) {
  renderWithLocale(<InquiryForm turnstileSiteKey={siteKey} />);
  if (siteKey !== null) {
    await waitFor(() => expect(turnstile.render).toHaveBeenCalled());
  }
}

function body(): HTMLTextAreaElement {
  return screen.getByLabelText("本文");
}

describe("InquiryForm の入力欄", () => {
  test("種別・本文・連絡先と送信ボタンを出す", async () => {
    await renderReady();

    expect(screen.getByLabelText("種別")).toBeInTheDocument();
    expect(body()).toBeInTheDocument();
    expect(screen.getByLabelText("連絡先 (任意)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "送信する" })).toBeEnabled();
  });

  test("英語表示では入力欄の名前も英語になる", async () => {
    renderWithLocale(<InquiryForm turnstileSiteKey={SITE_KEY} />, "en");
    await waitFor(() => expect(turnstile.render).toHaveBeenCalled());

    expect(screen.getByLabelText("Message")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });
});

describe("InquiryForm の送信", () => {
  test("本文を送ると受け付けたことを出し、入力欄を空に戻す", async () => {
    const user = userEvent.setup();
    await renderReady();

    await user.selectOptions(screen.getByLabelText("種別"), "bug");
    await user.type(body(), "再現手順つきの報告");
    await user.type(screen.getByLabelText("連絡先 (任意)"), "example@example.com");
    await user.click(screen.getByRole("button", { name: "送信する" }));

    await waitFor(() =>
      expect(submitInquiryFn).toHaveBeenCalledWith({
        data: {
          kind: "bug",
          body: "再現手順つきの報告",
          contact: "example@example.com",
          turnstileToken: "test-token",
        },
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "送信しました。ありがとうございます。",
    );
    expect(body()).toHaveValue("");
    expect(screen.getByLabelText("連絡先 (任意)")).toHaveValue("");
    // トークンは 1 回しか使えないので widget を引き直す
    expect(turnstile.reset).toHaveBeenCalled();
  });

  /** 未記入の連絡先は空文字ではなく「無い」として送る */
  test("連絡先が空なら添えずに送る", async () => {
    const user = userEvent.setup();
    await renderReady();

    await user.type(body(), "連絡先なしの要望");
    await user.click(screen.getByRole("button", { name: "送信する" }));

    await waitFor(() =>
      expect(submitInquiryFn).toHaveBeenCalledWith({
        data: { kind: "request", body: "連絡先なしの要望", turnstileToken: "test-token" },
      }),
    );
  });
});

describe("InquiryForm が送らない場合", () => {
  test("本文が空なら送らず理由を出す", async () => {
    const user = userEvent.setup();
    await renderReady();

    await user.type(body(), "   ");
    await user.click(screen.getByRole("button", { name: "送信する" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("本文を入力してください。");
    expect(submitInquiryFn).not.toHaveBeenCalled();
  });

  test("本文が上限を超えるなら送らず理由を出す", async () => {
    const user = userEvent.setup();
    await renderReady();

    // 1 文字ずつ打つと上限の桁では時間がかかりすぎるので、まとめて入れる
    fireEvent.change(body(), { target: { value: "あ".repeat(INQUIRY_BODY_MAX_LENGTH + 1) } });
    await user.click(screen.getByRole("button", { name: "送信する" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      `本文は ${INQUIRY_BODY_MAX_LENGTH} 文字以内で入力してください。`,
    );
    expect(submitInquiryFn).not.toHaveBeenCalled();
  });

  test("連絡先が上限を超えるなら送らず理由を出す", async () => {
    const user = userEvent.setup();
    await renderReady();

    fireEvent.change(body(), { target: { value: "要望" } });
    fireEvent.change(screen.getByLabelText("連絡先 (任意)"), {
      target: { value: "a".repeat(INQUIRY_CONTACT_MAX_LENGTH + 1) },
    });
    await user.click(screen.getByRole("button", { name: "送信する" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      `連絡先は ${INQUIRY_CONTACT_MAX_LENGTH} 文字以内で入力してください。`,
    );
    expect(submitInquiryFn).not.toHaveBeenCalled();
  });

  /** 鍵が無い環境。入力欄は出したまま、送信だけを止める */
  test("site key が無ければ送信ボタンを押せず、widget も読み込まない", async () => {
    await renderReady(null);

    expect(body()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "送信する" })).toBeDisabled();
    expect(turnstile.render).not.toHaveBeenCalled();
  });

  /** widget がまだ通っていないうちに押されたとき */
  test("トークンがまだ無ければ送らず待つよう伝える", async () => {
    const user = userEvent.setup();
    turnstile.render.mockImplementationOnce(() => "widget-1");
    await renderReady();

    await user.type(body(), "要望");
    await user.click(screen.getByRole("button", { name: "送信する" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "bot 対策の確認が終わるまで少しお待ちください。",
    );
    expect(submitInquiryFn).not.toHaveBeenCalled();
  });
});

describe("InquiryForm がサーバーに拒まれたとき", () => {
  /** 503 は鍵の置き忘れ、403 は検証を通らなかったとき。直し方が違うので別の文言にする */
  test("503 なら受け付けの設定が無いことを伝える", async () => {
    const user = userEvent.setup();
    submitInquiryFn.mockRejectedValue(new Response("", { status: 503 }));
    await renderReady();

    await user.type(body(), "要望");
    await user.click(screen.getByRole("button", { name: "送信する" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "お問い合わせの受け付けが設定されていません。",
    );
  });

  test("403 なら bot 対策を通らなかったことを伝える", async () => {
    const user = userEvent.setup();
    submitInquiryFn.mockRejectedValue(new Response("", { status: 403 }));
    await renderReady();

    await user.type(body(), "要望");
    await user.click(screen.getByRole("button", { name: "送信する" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "bot 対策の確認を通りませんでした。",
    );
  });

  test("状態コードが読めない失敗はまとめて伝える", async () => {
    const user = userEvent.setup();
    submitInquiryFn.mockRejectedValue(new Error("架空の失敗"));
    await renderReady();

    await user.type(body(), "要望");
    await user.click(screen.getByRole("button", { name: "送信する" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("送信できませんでした。");
  });
});
