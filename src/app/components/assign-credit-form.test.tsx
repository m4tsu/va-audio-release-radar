import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { AssignCreditForm } from "@/app/components/assign-credit-form";
import { actorSummary, unmatchedCreditGroup } from "@/app/test/fixtures";
import { renderWithLocale } from "@/app/test/render";
import { routerStub } from "@/app/test/router-stub";

const assignCreditFn = vi.fn<(input: unknown) => Promise<unknown>>(async () => ({ updated: 1 }));
vi.mock("@/app/server-fns/admin", () => ({
  assignCreditFn: (input: unknown) => assignCreditFn(input),
}));

const ALPHA = actorSummary({
  id: "va_alpha",
  canonicalName: "架空アルファ",
  nameKana: "かくうあるふぁ",
});
const BETA = actorSummary({ id: "va_beta", slug: "beta", canonicalName: "架空ベータ" });
const ACTORS = [ALPHA, BETA];

/** 候補は「正規化後の名前が一致する声優」。あれば最初から選ばれている */
const WITH_CANDIDATE = unmatchedCreditGroup({
  candidate: { id: "va_alpha", slug: "alpha", canonicalName: "架空アルファ" },
});

beforeEach(() => {
  assignCreditFn.mockReset();
  assignCreditFn.mockResolvedValue({ updated: 1 });
});

describe("AssignCreditForm の送信", () => {
  test("候補があれば最初から選ばれていて、そのまま割り当てられる", async () => {
    const user = userEvent.setup();
    renderWithLocale(<AssignCreditForm group={WITH_CANDIDATE} actors={ACTORS} />);

    expect(screen.getByRole("combobox", { name: "割り当てる声優" })).toHaveValue("va_alpha");

    await user.click(screen.getByRole("button", { name: "3 件を割り当てる" }));

    expect(assignCreditFn).toHaveBeenCalledWith({
      data: {
        creditedName: "架空の未解決表記",
        sourceStoreSlug: "dlsite",
        voiceActorId: "va_alpha",
        addAlias: true,
      },
    });
  });

  /** 割り当てた表記は一覧から消える。ローダーを引き直して反映する */
  test("成功したらローダーを引き直す", async () => {
    const user = userEvent.setup();
    renderWithLocale(<AssignCreditForm group={WITH_CANDIDATE} actors={ACTORS} />);

    await user.click(screen.getByRole("button", { name: "3 件を割り当てる" }));

    expect(routerStub.invalidateCount).toBe(1);
  });

  test("失敗したら理由を出し、引き直さない", async () => {
    const user = userEvent.setup();
    assignCreditFn.mockRejectedValueOnce(new Error("架空の失敗"));
    renderWithLocale(<AssignCreditForm group={WITH_CANDIDATE} actors={ACTORS} />);

    await user.click(screen.getByRole("button", { name: "3 件を割り当てる" }));

    expect(await screen.findByText("架空の失敗")).toBeInTheDocument();
    expect(routerStub.invalidateCount).toBe(0);
  });

  test("候補が無ければ選ぶまで押せない", async () => {
    const user = userEvent.setup();
    renderWithLocale(<AssignCreditForm group={unmatchedCreditGroup()} actors={ACTORS} />);

    expect(screen.getByText("候補なし。一覧から選ぶこと。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "3 件を割り当てる" })).toBeDisabled();

    await user.selectOptions(screen.getByRole("combobox", { name: "割り当てる声優" }), "va_beta");

    expect(screen.getByRole("button", { name: "3 件を割り当てる" })).toBeEnabled();
  });
});

describe("AssignCreditForm のエイリアス登録", () => {
  /** 次回以降の ingest が同じ表記を自動で解決できるようにするため既定で on */
  test("既定で on になっている", () => {
    renderWithLocale(<AssignCreditForm group={WITH_CANDIDATE} actors={ACTORS} />);

    expect(
      screen.getByRole("checkbox", { name: "この表記をエイリアスとして登録する" }),
    ).toBeChecked();
  });

  test("外して送ると addAlias が false で届く", async () => {
    const user = userEvent.setup();
    renderWithLocale(<AssignCreditForm group={WITH_CANDIDATE} actors={ACTORS} />);

    await user.click(screen.getByRole("checkbox", { name: "この表記をエイリアスとして登録する" }));
    await user.click(screen.getByRole("button", { name: "3 件を割り当てる" }));

    expect(assignCreditFn).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ addAlias: false }) }),
    );
  });
});

describe("AssignCreditForm の絞り込み", () => {
  test("正規表記に当たる", async () => {
    const user = userEvent.setup();
    renderWithLocale(<AssignCreditForm group={unmatchedCreditGroup()} actors={ACTORS} />);

    await user.type(screen.getByRole("searchbox", { name: "声優を絞り込む" }), "ベータ");

    const names = within(screen.getByRole("combobox", { name: "割り当てる声優" }))
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(names).toEqual(["選択してください", "架空ベータ"]);
  });

  test("読み仮名にも当たる", async () => {
    const user = userEvent.setup();
    renderWithLocale(<AssignCreditForm group={unmatchedCreditGroup()} actors={ACTORS} />);

    await user.type(screen.getByRole("searchbox", { name: "声優を絞り込む" }), "かくうあるふぁ");

    const names = within(screen.getByRole("combobox", { name: "割り当てる声優" }))
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(names).toEqual(["選択してください", "架空アルファ (かくうあるふぁ)"]);
  });
});
