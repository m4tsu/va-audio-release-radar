import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ActorSearch } from "@/app/components/actor-search";
import { LocaleContext } from "@/app/i18n";

/** server function はブラウザから呼べないので差し替える。ここでは入力前の姿だけを見る */
vi.mock("@/app/server-fns/actors", () => ({ searchActorsFn: vi.fn(async () => []) }));

describe("ActorSearch の入力欄", () => {
  /** 実在の声優 1 人を例示すると、その人を推しているように読めるので置かない */
  test("入力前の例示を置かない", () => {
    render(<ActorSearch />);

    expect(screen.getByLabelText("声優名で検索")).not.toHaveAttribute("placeholder");
  });

  test("英語表示でも例示を置かず、ラベルは出る", () => {
    render(
      <LocaleContext value="en">
        <ActorSearch />
      </LocaleContext>,
    );

    expect(screen.getByLabelText("Search by voice actor")).not.toHaveAttribute("placeholder");
  });
});
