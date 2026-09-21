import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { AppShell, ErrorScreen, NotFoundScreen } from "@/app/components/app-shell";
import { useFollowStore } from "@/app/store/follow-store";
import { renderWithLocale } from "@/app/test/render";
import { routerStub } from "@/app/test/router-stub";

/** 言語の切り替えは cookie を書く。ここで見たいのは外枠なので、その 1 関数だけ差し替える */
vi.mock("@/app/server-fns/locale", () => ({ writeLocaleCookie: vi.fn() }));

describe("AppShell の導線", () => {
  test("ヘッダーに 4 つの入口を並べる", () => {
    renderWithLocale(<AppShell />);

    const nav = within(screen.getByRole("banner")).getByRole("navigation");
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/", "/voice-actors", "/anime", "/following"]);
  });

  test("フッターに非公式である旨と法務ページへの導線を置く", () => {
    renderWithLocale(<AppShell />);

    const footer = screen.getByRole("contentinfo");
    expect(footer).toHaveTextContent("各ストアとは関係のない非公式サービスです");
    expect(within(footer).getByRole("link", { name: "利用規約" })).toHaveAttribute(
      "href",
      "/terms",
    );
    expect(within(footer).getByRole("link", { name: "プライバシーポリシー" })).toHaveAttribute(
      "href",
      "/privacy",
    );
    expect(within(footer).getByRole("link", { name: "お問い合わせ" })).toHaveAttribute(
      "href",
      "/contact",
    );
  });

  test("表示の設定 (言語と配色) をヘッダーに置く", () => {
    renderWithLocale(<AppShell />);

    const header = within(screen.getByRole("banner"));
    expect(header.getByRole("combobox")).toHaveTextContent("日本語");
    expect(header.getByRole("button", { name: /に切り替える$/ })).toBeInTheDocument();
  });

  test("英語表示ではヘッダーの文言も英語になる", () => {
    renderWithLocale(<AppShell />, "en");

    const nav = within(screen.getByRole("banner")).getByRole("navigation");
    expect(within(nav).getByRole("link", { name: "Voice actors" })).toBeInTheDocument();
  });
});

describe("AppShell のフォロー読み込み", () => {
  /**
   * フォローはブラウザ内にしか無い。SSR では読めないので、
   * マウント後にここが 1 回だけ読み込む。他のページはこれに乗る
   */
  test("マウントするとフォローの読み込みを始め、読み込み済みになる", async () => {
    expect(useFollowStore.getState().status).toBe("idle");

    renderWithLocale(<AppShell />);

    await vi.waitFor(() => {
      expect(useFollowStore.getState().status).toBe("ready");
    });
  });
});

describe("NotFoundScreen", () => {
  test("見つからないことを言い、トップへ戻す", () => {
    renderWithLocale(<NotFoundScreen />);

    expect(
      screen.getByRole("heading", { level: 1, name: "ページが見つかりません" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "トップへ" })).toHaveAttribute("href", "/");
  });
});

describe("ErrorScreen", () => {
  /** 例外のメッセージは英語のことも日本語のこともある。訳さずそのまま出す */
  test("例外の本文をそのまま出す", () => {
    renderWithLocale(<ErrorScreen error={new Error("架空の失敗")} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "表示できませんでした" }),
    ).toBeInTheDocument();
    expect(screen.getByText("架空の失敗")).toBeInTheDocument();
  });

  test("Error でないものが渡っても画面は出る", () => {
    renderWithLocale(<ErrorScreen error="文字列" />);

    expect(
      screen.getByRole("heading", { level: 1, name: "表示できませんでした" }),
    ).toBeInTheDocument();
  });

  /** 一時的な失敗が多いので、まず再試行の手段を出す */
  test("再試行を押すとローダーを引き直す", async () => {
    const user = userEvent.setup();
    renderWithLocale(<ErrorScreen error={new Error("架空の失敗")} />);

    await user.click(screen.getByRole("button", { name: "再試行" }));

    expect(routerStub.invalidateCount).toBe(1);
  });
});
