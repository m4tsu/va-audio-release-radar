import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { CreditExclusionButton } from "@/app/components/credit-exclusion-button";
import { renderWithLocale } from "@/app/test/render";
import { routerStub } from "@/app/test/router-stub";

const excludeCreditNameFn = vi.fn<(input: unknown) => Promise<void>>(async () => undefined);
const unexcludeCreditNameFn = vi.fn<(input: unknown) => Promise<void>>(async () => undefined);
vi.mock("@/app/server-fns/admin", () => ({
  excludeCreditNameFn: (input: unknown) => excludeCreditNameFn(input),
  unexcludeCreditNameFn: (input: unknown) => unexcludeCreditNameFn(input),
}));

const NAME = { creditedName: "架空の表記", sourceStoreSlug: "dlsite" as const };

beforeEach(() => {
  excludeCreditNameFn.mockReset();
  unexcludeCreditNameFn.mockReset();
});

describe("CreditExclusionButton", () => {
  test("対象外にすると、その表記 × ストアに印を付けてローダーを引き直す", async () => {
    const user = userEvent.setup();
    renderWithLocale(<CreditExclusionButton name={NAME} action="exclude" />);

    await user.click(screen.getByRole("button", { name: "対象外にする" }));

    expect(excludeCreditNameFn).toHaveBeenCalledWith({ data: NAME });
    expect(unexcludeCreditNameFn).not.toHaveBeenCalled();
    expect(routerStub.invalidateCount).toBe(1);
  });

  test("印を外すと、その表記 × ストアの印を消してローダーを引き直す", async () => {
    const user = userEvent.setup();
    renderWithLocale(<CreditExclusionButton name={NAME} action="restore" />);

    await user.click(screen.getByRole("button", { name: "印を外す" }));

    expect(unexcludeCreditNameFn).toHaveBeenCalledWith({ data: NAME });
    expect(excludeCreditNameFn).not.toHaveBeenCalled();
    expect(routerStub.invalidateCount).toBe(1);
  });

  test("失敗したら理由を出し、引き直さず、もう一度押せる", async () => {
    const user = userEvent.setup();
    excludeCreditNameFn.mockRejectedValueOnce(new Error("架空の失敗"));
    renderWithLocale(<CreditExclusionButton name={NAME} action="exclude" />);

    await user.click(screen.getByRole("button", { name: "対象外にする" }));

    expect(await screen.findByText("架空の失敗")).toBeInTheDocument();
    expect(routerStub.invalidateCount).toBe(0);
    expect(screen.getByRole("button", { name: "対象外にする" })).toBeEnabled();
  });
});
