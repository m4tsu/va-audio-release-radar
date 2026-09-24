import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { HelpPopover } from "@/app/components/help-popover";
import { renderWithLocale } from "@/app/test/render";

function renderHelp() {
  renderWithLocale(
    <HelpPopover label="保存先の説明">
      <p>このブラウザにのみ保存されます</p>
    </HelpPopover>,
  );
  return screen.getByRole("button", { name: "保存先の説明" });
}

describe("HelpPopover", () => {
  test("閉じている間は説明を出さず、印は読み上げ名で何の説明かを言う", () => {
    const trigger = renderHelp();

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("このブラウザにのみ保存されます")).not.toBeInTheDocument();
  });

  test("押すと開き、もう一度押すと閉じる", async () => {
    const user = userEvent.setup();
    const trigger = renderHelp();

    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "保存先の説明" })).toHaveTextContent(
      "このブラウザにのみ保存されます",
    );
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    await user.click(trigger);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("キーボードで開き、Esc で閉じて印にフォーカスが戻る", async () => {
    const user = userEvent.setup();
    const trigger = renderHelp();

    await user.tab();
    expect(trigger).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: "保存先の説明" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  test("マウスを重ねると開き、離れると閉じる", async () => {
    const user = userEvent.setup();
    const trigger = renderHelp();

    await user.hover(trigger);
    expect(screen.getByRole("dialog", { name: "保存先の説明" })).toBeInTheDocument();

    await user.unhover(trigger);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("重ねて開いた後に押すと、離れても開いたままになる", async () => {
    const user = userEvent.setup();
    const trigger = renderHelp();

    await user.hover(trigger);
    await user.click(trigger);
    await user.unhover(trigger);
    // 重ねて開いたときの閉じる待ち時間より長く待っても閉じない
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(screen.getByRole("dialog", { name: "保存先の説明" })).toBeInTheDocument();
  });
});
