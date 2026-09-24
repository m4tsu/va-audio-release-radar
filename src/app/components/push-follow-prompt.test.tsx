import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { PushFollowPrompt } from "@/app/components/push-follow-prompt";
import { resetPushStoreForTest, usePushStore } from "@/app/store/push-store";
import { renderWithLocale } from "@/app/test/render";

/** 購読の段取りは push-store.test.ts が見る。ここでは出す条件と、押したら store が呼ばれることだけ */
vi.mock("@/app/server-fns/push", () => ({
  savePushSubscriptionFn: vi.fn(),
  deletePushSubscriptionFn: vi.fn(),
}));

const KEY = "BExampleKey";
const PROMPT = "フォローした声優の新作が出たら、このブラウザに通知できます。";
const subscribe = vi.fn(async (_key: string) => {});

beforeEach(() => {
  subscribe.mockClear();
  usePushStore.setState({ subscribe });
});

afterEach(async () => {
  await resetPushStoreForTest();
});

describe("PushFollowPrompt の出し分け", () => {
  test("未購読なら案内と受け取るボタンを出す", () => {
    usePushStore.setState({ status: "unsubscribed" });
    renderWithLocale(<PushFollowPrompt vapidPublicKey={KEY} />);

    expect(screen.getByText(PROMPT)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新作の通知を受け取る" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "新作の通知の説明" })).toBeInTheDocument();
  });

  test.each([
    ["購読済み", "subscribed"],
    ["非対応", "unsupported"],
    ["ブロック中", "denied"],
    ["調べ終わる前", "idle"],
  ] as const)("出した時点で%sなら何も出さない", (_label, status) => {
    usePushStore.setState({ status });
    const { container } = renderWithLocale(<PushFollowPrompt vapidPublicKey={KEY} />);

    expect(container).toBeEmptyDOMElement();
  });

  test("公開鍵が無ければ何も出さない", () => {
    usePushStore.setState({ status: "unsubscribed" });
    const { container } = renderWithLocale(<PushFollowPrompt vapidPublicKey={null} />);

    expect(container).toBeEmptyDOMElement();
  });

  test("英語表示では英語になる", () => {
    usePushStore.setState({ status: "unsubscribed" });
    renderWithLocale(<PushFollowPrompt vapidPublicKey={KEY} />, "en");

    expect(
      screen.getByText(
        "When a voice actor you follow has a new release, this browser can notify you.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Get new release alerts" })).toBeInTheDocument();
  });
});

describe("PushFollowPrompt の操作", () => {
  test("受け取るボタンは公開鍵を渡して購読を始める", async () => {
    const user = userEvent.setup();
    usePushStore.setState({ status: "unsubscribed" });
    renderWithLocale(<PushFollowPrompt vapidPublicKey={KEY} />);

    await user.click(screen.getByRole("button", { name: "新作の通知を受け取る" }));

    expect(subscribe).toHaveBeenCalledWith(KEY);
  });

  /** 購読が済んだら案内を消すと、押した結果が見えない */
  test("購読が済んだら、案内を消さずに設定済みと言う", () => {
    usePushStore.setState({ status: "unsubscribed" });
    renderWithLocale(<PushFollowPrompt vapidPublicKey={KEY} />);

    act(() => usePushStore.setState({ status: "subscribed" }));

    expect(screen.getByRole("status")).toHaveTextContent(
      "このブラウザで新作の通知を受け取る設定になっています。",
    );
    expect(screen.queryByRole("button", { name: "新作の通知を受け取る" })).not.toBeInTheDocument();
  });

  test("許可を求めて拒否されたら、設定で許可する案内を出す", () => {
    usePushStore.setState({ status: "unsubscribed" });
    renderWithLocale(<PushFollowPrompt vapidPublicKey={KEY} />);

    act(() => usePushStore.setState({ status: "denied" }));

    expect(screen.getByText(/通知がブラウザの設定でブロックされています/)).toBeInTheDocument();
  });

  test("失敗していればその旨を alert で出す", () => {
    usePushStore.setState({ status: "unsubscribed" });
    renderWithLocale(<PushFollowPrompt vapidPublicKey={KEY} />);

    act(() => usePushStore.setState({ error: "failed" }));

    expect(screen.getByRole("alert")).toHaveTextContent("通知の設定を保存できませんでした");
  });
});
