import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { FollowButton } from "@/app/components/follow-button";
import { useFollowStore } from "@/app/store/follow-store";
import { readyFollowStore } from "@/app/test/follow";
import { renderWithLocale } from "@/app/test/render";

const ALPHA = { voiceActorId: "va_alpha", slug: "alpha", canonicalName: "架空アルファ" };

describe("FollowButton", () => {
  /**
   * フォロー状態はブラウザ内にしか無いので SSR では必ず未フォローで描かれる。
   * 読み込みが済む前に押せると、直後に届いた保存済みの状態で操作が消えたように見える
   */
  test("読み込みが済むまでは押せず、未フォローの見た目で出る", () => {
    renderWithLocale(<FollowButton actor={ALPHA} />);

    const button = screen.getByRole("button", { name: "フォロー" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  test("押すとフォローされ、もう一度押すと解除される", async () => {
    const user = userEvent.setup();
    await readyFollowStore();
    renderWithLocale(<FollowButton actor={ALPHA} />);

    await user.click(screen.getByRole("button", { name: "フォロー" }));
    expect(useFollowStore.getState().isFollowing("va_alpha")).toBe(true);
    expect(screen.getByRole("button", { name: "フォロー中" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "フォロー中" }));
    expect(useFollowStore.getState().isFollowing("va_alpha")).toBe(false);
  });

  test("既にフォロー済みなら最初からフォロー中で出る", async () => {
    await readyFollowStore();
    await useFollowStore.getState().follow(ALPHA);
    renderWithLocale(<FollowButton actor={ALPHA} />);

    expect(screen.getByRole("button", { name: "フォロー中" })).toBeInTheDocument();
  });

  /** ローマ字はフォローする時点で一緒に保存する。後からサーバーに引き直さないため */
  test("ローマ字を持つ声優は、その表記も一緒に保存する", async () => {
    const user = userEvent.setup();
    await readyFollowStore();
    renderWithLocale(<FollowButton actor={{ ...ALPHA, nameEn: "Kakuu Alpha" }} />);

    await user.click(screen.getByRole("button", { name: "フォロー" }));

    expect(useFollowStore.getState().follows[0]?.nameEn).toBe("Kakuu Alpha");
  });

  test("英語表示では文言も英語になる", async () => {
    await readyFollowStore();
    renderWithLocale(<FollowButton actor={ALPHA} />, "en");

    expect(screen.getByRole("button", { name: "Follow" })).toBeInTheDocument();
  });
});
