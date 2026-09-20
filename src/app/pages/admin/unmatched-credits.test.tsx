import { screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { UnmatchedCreditsPage } from "@/app/pages/admin/unmatched-credits";
import { actorSummary, unmatchedCreditGroup } from "@/app/test/fixtures";
import { renderWithLocale } from "@/app/test/render";

/** 割り当ての送信は assign-credit-form.test.tsx が見る。ここでは呼び先を塞ぐだけ */
vi.mock("@/app/server-fns/admin", () => ({ assignCreditFn: vi.fn(async () => ({ updated: 1 })) }));

const ALPHA = actorSummary({
  id: "va_alpha",
  canonicalName: "架空アルファ",
  nameKana: "かくうあるふぁ",
});
const BETA = actorSummary({ id: "va_beta", slug: "beta", canonicalName: "架空ベータ" });
const ACTORS = [ALPHA, BETA];

describe("UnmatchedCreditsPage の認可", () => {
  test("トークンが通っていなければ一覧を出さない", () => {
    renderWithLocale(<UnmatchedCreditsPage authorized={false} configured />);

    expect(
      screen.getByRole("heading", { level: 1, name: "管理者トークンが必要です" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});

describe("UnmatchedCreditsPage の一覧", () => {
  test("表記・ストア・件数と、その表記が付いた作品への導線を出す", () => {
    renderWithLocale(
      <UnmatchedCreditsPage authorized groups={[unmatchedCreditGroup()]} actors={ACTORS} />,
    );

    expect(screen.getByText("架空の未解決表記")).toBeInTheDocument();
    expect(screen.getByText("DLsite")).toBeInTheDocument();
    expect(screen.getByText("3 件")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "架空のASMR作品" })).toHaveAttribute(
      "href",
      "/works/dlsite:RJ1",
    );
  });

  test("未解決が 1 件も無ければ、無いと言う", () => {
    renderWithLocale(<UnmatchedCreditsPage authorized groups={[]} actors={ACTORS} />);

    expect(screen.getByText("未解決の表記はない。")).toBeInTheDocument();
  });
});
