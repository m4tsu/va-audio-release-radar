import { screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { UnmatchedCreditsPage } from "@/app/pages/admin/unmatched-credits";
import { actorSummary, excludedCreditName, unmatchedCreditGroup } from "@/app/test/fixtures";
import { renderWithLocale } from "@/app/test/render";

/**
 * 送信は assign-credit-form.test.tsx と credit-exclusion-button.test.tsx が見る。
 * ここでは呼び先を塞ぐだけ
 */
vi.mock("@/app/server-fns/admin", () => ({
  assignCreditFn: vi.fn(async () => ({ updated: 1 })),
  excludeCreditNameFn: vi.fn(async () => undefined),
  unexcludeCreditNameFn: vi.fn(async () => undefined),
}));

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
      <UnmatchedCreditsPage
        authorized
        groups={[unmatchedCreditGroup()]}
        actors={ACTORS}
        excluded={[]}
      />,
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
    renderWithLocale(<UnmatchedCreditsPage authorized groups={[]} actors={ACTORS} excluded={[]} />);

    expect(screen.getByText("未解決の表記はない。")).toBeInTheDocument();
  });

  test("他の管理画面への導線を置き、自分自身へは出さない", () => {
    renderWithLocale(<UnmatchedCreditsPage authorized groups={[]} actors={ACTORS} excluded={[]} />);

    expect(screen.getByRole("link", { name: "クローラー健全性へ" })).toHaveAttribute(
      "href",
      "/admin/crawler-health",
    );
    expect(screen.getByRole("link", { name: "問い合わせへ" })).toHaveAttribute(
      "href",
      "/admin/inquiries",
    );
    expect(screen.queryByRole("link", { name: "未解決クレジットへ" })).not.toBeInTheDocument();
  });
});

describe("UnmatchedCreditsPage の対象外", () => {
  test("キューの各表記に対象外にする操作がある", () => {
    renderWithLocale(
      <UnmatchedCreditsPage
        authorized
        groups={[
          unmatchedCreditGroup(),
          unmatchedCreditGroup({ creditedName: "別の未解決表記", sourceStoreSlug: "audible" }),
        ]}
        actors={ACTORS}
        excluded={[]}
      />,
    );

    expect(screen.getAllByRole("button", { name: "対象外にする" })).toHaveLength(2);
  });

  test("対象外にした表記をストアと日時つきで並べ、印を外す操作を置く", () => {
    renderWithLocale(
      <UnmatchedCreditsPage
        authorized
        groups={[]}
        actors={ACTORS}
        excluded={[excludedCreditName({ sourceStoreSlug: "audible" })]}
      />,
    );

    const section = screen.getByRole("region", { name: "対象外にした表記" });
    expect(within(section).getByText("架空の対象外表記")).toBeInTheDocument();
    expect(within(section).getByText("Audible")).toBeInTheDocument();
    expect(within(section).getByText(/に対象外にした$/)).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "印を外す" })).toBeInTheDocument();
  });

  test("対象外にした表記が無ければ、無いと言う", () => {
    renderWithLocale(<UnmatchedCreditsPage authorized groups={[]} actors={ACTORS} excluded={[]} />);

    const section = screen.getByRole("region", { name: "対象外にした表記" });
    expect(within(section).getByText("対象外にした表記はない。")).toBeInTheDocument();
    expect(within(section).queryByRole("button")).not.toBeInTheDocument();
  });
});
