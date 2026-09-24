import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { PushSubscriptionCard } from "@/app/components/push-subscription-card";
import { resetPushStoreForTest, usePushStore } from "@/app/store/push-store";
import { renderWithLocale } from "@/app/test/render";

/** 購読の段取りは push-store.test.ts が見る。ここでは状態ごとの見え方と、押したら store が呼ばれることだけ */
vi.mock("@/app/server-fns/push", () => ({
  savePushSubscriptionFn: vi.fn(),
  deletePushSubscriptionFn: vi.fn(),
}));

const KEY = "BExampleKey";
const subscribe = vi.fn(async (_key: string) => {});
const unsubscribe = vi.fn(async () => {});

beforeEach(() => {
  subscribe.mockClear();
  unsubscribe.mockClear();
  usePushStore.setState({ subscribe, unsubscribe });
});

afterEach(async () => {
  await resetPushStoreForTest();
});

describe("PushSubscriptionCard の出し分け", () => {
  test("公開鍵が無ければ何も出さない", () => {
    usePushStore.setState({ status: "unsubscribed" });
    renderWithLocale(<PushSubscriptionCard vapidPublicKey={null} />);

    expect(screen.queryByRole("heading", { name: "新作の通知" })).not.toBeInTheDocument();
  });

  test("調べ終わる前は何も出さない", () => {
    renderWithLocale(<PushSubscriptionCard vapidPublicKey={KEY} />);

    expect(screen.queryByRole("heading", { name: "新作の通知" })).not.toBeInTheDocument();
  });

  test("未購読なら受け取るボタンを出し、説明と保存の注記は常には出さない", () => {
    usePushStore.setState({ status: "unsubscribed" });
    renderWithLocale(<PushSubscriptionCard vapidPublicKey={KEY} />);

    expect(screen.getByRole("heading", { name: "新作の通知" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新作の通知を受け取る" })).toBeEnabled();
    expect(screen.queryByText(/このブラウザへ 1 通だけ通知します/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/フォロー中の声優と通知の宛先をサーバーに保存します/),
    ).not.toBeInTheDocument();
  });

  test("購読中も保存の注記は常には出さない", () => {
    usePushStore.setState({ status: "subscribed" });
    renderWithLocale(<PushSubscriptionCard vapidPublicKey={KEY} />);

    expect(
      screen.queryByText(/フォロー中の声優と通知の宛先をサーバーに保存します/),
    ).not.toBeInTheDocument();
  });

  test("ヘルプの印を押すと、何がサーバーに渡るかの注記とプライバシーポリシーへのリンクを出す", async () => {
    const user = userEvent.setup();
    usePushStore.setState({ status: "unsubscribed" });
    renderWithLocale(<PushSubscriptionCard vapidPublicKey={KEY} />);

    await user.click(screen.getByRole("button", { name: "新作の通知の説明" }));

    const help = screen.getByRole("dialog", { name: "新作の通知の説明" });
    expect(
      within(help).getByText(/フォロー中の声優と通知の宛先をサーバーに保存します/),
    ).toBeInTheDocument();
    expect(within(help).getByRole("link", { name: "プライバシーポリシー" })).toHaveAttribute(
      "href",
      "/privacy",
    );
  });

  test("購読中なら設定済みと言い、止めるボタンを出す", () => {
    usePushStore.setState({ status: "subscribed" });
    renderWithLocale(<PushSubscriptionCard vapidPublicKey={KEY} />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "このブラウザで新作の通知を受け取る設定になっています。",
    );
    expect(screen.getByRole("button", { name: "通知を止める" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "新作の通知を受け取る" })).not.toBeInTheDocument();
  });

  test("対応していないブラウザではボタンを出さず、その旨を出す", () => {
    usePushStore.setState({ status: "unsupported", guidance: null });
    renderWithLocale(<PushSubscriptionCard vapidPublicKey={KEY} />);

    expect(screen.getByText(/このブラウザは通知に対応していません/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /通知を/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/ホーム画面に追加/)).not.toBeInTheDocument();
  });

  test("iOS でホーム画面に追加していなければ、その手順を添える", () => {
    usePushStore.setState({ status: "unsupported", guidance: "ios-add-to-home" });
    renderWithLocale(<PushSubscriptionCard vapidPublicKey={KEY} />);

    expect(screen.getByText(/「ホーム画面に追加」し/)).toBeInTheDocument();
  });

  test("拒否されていればボタンを出さず、設定で許可する案内を出す", () => {
    usePushStore.setState({ status: "denied" });
    renderWithLocale(<PushSubscriptionCard vapidPublicKey={KEY} />);

    expect(screen.getByText(/通知がブラウザの設定でブロックされています/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /通知を/ })).not.toBeInTheDocument();
  });

  test("失敗していればその旨を alert で出す", () => {
    usePushStore.setState({ status: "unsubscribed", error: "failed" });
    renderWithLocale(<PushSubscriptionCard vapidPublicKey={KEY} />);

    expect(screen.getByRole("alert")).toHaveTextContent("通知の設定を保存できませんでした");
  });

  test("英語表示では英語になる", () => {
    usePushStore.setState({ status: "unsubscribed" });
    renderWithLocale(<PushSubscriptionCard vapidPublicKey={KEY} />, "en");

    expect(screen.getByRole("heading", { name: "New release alerts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Get new release alerts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "About new release alerts" })).toBeInTheDocument();
    expect(screen.queryByText(/stored on the server/)).not.toBeInTheDocument();
  });
});

describe("PushSubscriptionCard の操作", () => {
  test("受け取るボタンは公開鍵を渡して購読を始める", async () => {
    const user = userEvent.setup();
    usePushStore.setState({ status: "unsubscribed" });
    renderWithLocale(<PushSubscriptionCard vapidPublicKey={KEY} />);

    await user.click(screen.getByRole("button", { name: "新作の通知を受け取る" }));

    expect(subscribe).toHaveBeenCalledWith(KEY);
  });

  test("止めるボタンは解除を呼ぶ", async () => {
    const user = userEvent.setup();
    usePushStore.setState({ status: "subscribed" });
    renderWithLocale(<PushSubscriptionCard vapidPublicKey={KEY} />);

    await user.click(screen.getByRole("button", { name: "通知を止める" }));

    expect(unsubscribe).toHaveBeenCalled();
  });

  test("処理中はボタンを押せず、進行中の文言になる", () => {
    usePushStore.setState({ status: "unsubscribed", busy: true });
    renderWithLocale(<PushSubscriptionCard vapidPublicKey={KEY} />);

    expect(screen.getByRole("button", { name: "設定しています…" })).toBeDisabled();
  });
});
