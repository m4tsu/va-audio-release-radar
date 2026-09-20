import { screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { AnimeIndexPage, type FeaturedSeason } from "@/app/pages/anime-index";
import { animeSeasonEntry, animeSummary } from "@/app/test/fixtures";
import { renderWithLocale } from "@/app/test/render";

/** 検索の部品がサーバーを呼ぶ。この画面のテストでは入力欄が出ることだけを見る */
vi.mock("@/app/server-fns/anime", () => ({ searchAnimeFn: vi.fn(async () => []) }));

const SEASONS = [
  animeSeasonEntry({ seasonYear: 2026, season: "FALL", animeCount: 12 }),
  animeSeasonEntry({ seasonYear: 2026, season: "SUMMER", animeCount: 9 }),
  animeSeasonEntry({ seasonYear: 2024, season: "WINTER", animeCount: 4 }),
];

/** 先頭に出す期。どの期を選ぶかはルート (`featuredSeason`) が決め、画面は受け取って描くだけ */
const FEATURED: FeaturedSeason = {
  seasonYear: 2026,
  season: "FALL",
  anime: [
    animeSummary({ slug: "anime-ichi", titleNative: "架空のアニメ壱" }),
    animeSummary({ slug: "anime-ni", titleNative: "架空のアニメ弐" }),
  ],
};

/** 先頭の一覧。見出しの期名で引ける */
function featuredSection(name: string) {
  return screen.getByRole("region", { name });
}

describe("AnimeIndexPage", () => {
  test("先頭に期の名前を見出しにした一覧を出し、作品のページへ結ぶ", () => {
    renderWithLocale(<AnimeIndexPage seasons={SEASONS} featured={FEATURED} />);

    const section = featuredSection("2026 年秋アニメ");
    const link = within(section).getByRole("link", { name: /架空のアニメ壱/ });
    expect(link).toHaveAttribute("href", "/anime/anime-ichi");
  });

  test("先頭の一覧は受け取った順 (人気順) に並べる", () => {
    renderWithLocale(<AnimeIndexPage seasons={SEASONS} featured={FEATURED} />);

    const items = within(featuredSection("2026 年秋アニメ")).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining("架空のアニメ壱"),
      expect.stringContaining("架空のアニメ弐"),
    ]);
  });

  test("その期のすべてを見る導線がシーズンのページへ向く", () => {
    renderWithLocale(<AnimeIndexPage seasons={SEASONS} featured={FEATURED} />);

    const link = within(featuredSection("2026 年秋アニメ")).getByRole("link", {
      name: "このシーズンをすべて見る",
    });
    expect(link).toHaveAttribute("href", "/anime/season/2026-fall");
  });

  /** 期の一覧と抜粋は別々に引く。取り違えで空になっても、行き先だけは出す */
  test("先頭の期に作品が無ければ、その期にアニメが無いことを言う", () => {
    renderWithLocale(<AnimeIndexPage seasons={SEASONS} featured={{ ...FEATURED, anime: [] }} />);

    expect(screen.getByText("2026 年秋のアニメはありません")).toBeInTheDocument();
    expect(
      within(featuredSection("2026 年秋アニメ")).getByRole("link", {
        name: "このシーズンをすべて見る",
      }),
    ).toBeInTheDocument();
  });

  test("アニメ名の検索を置く", () => {
    renderWithLocale(<AnimeIndexPage seasons={SEASONS} featured={FEATURED} />);

    expect(screen.getByLabelText("アニメ名で検索")).toBeInTheDocument();
  });

  test("シーズンが 1 つも無ければ検索も出さない", () => {
    renderWithLocale(<AnimeIndexPage seasons={[]} featured={null} />);

    expect(screen.queryByLabelText("アニメ名で検索")).not.toBeInTheDocument();
  });

  test("シーズンを並べ、それぞれのシーズン一覧へ結ぶ", () => {
    renderWithLocale(<AnimeIndexPage seasons={SEASONS} featured={FEATURED} />);

    const list = screen.getByRole("list", { name: "シーズン" });
    expect(within(list).getAllByRole("link")).toHaveLength(3);

    const link = within(list).getByRole("link", { name: /2026 年秋/ });
    expect(link).toHaveAttribute("href", "/anime/season/2026-fall");
    expect(link).toHaveTextContent("12 作品");
  });

  /** 渡された並び (新しい順) をそのまま出す。並べ替えはサーバーが決める */
  test("受け取った順に並べる", () => {
    renderWithLocale(<AnimeIndexPage seasons={SEASONS} featured={FEATURED} />);

    const links = within(screen.getByRole("list", { name: "シーズン" })).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/anime/season/2026-fall",
      "/anime/season/2026-summer",
      "/anime/season/2024-winter",
    ]);
  });

  test("出せるシーズンが 1 つも無ければ、アニメが無いことを言う", () => {
    renderWithLocale(<AnimeIndexPage seasons={[]} featured={null} />);

    expect(screen.getByText("アニメがありません")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "シーズン" })).not.toBeInTheDocument();
  });

  test("英語表示でも本文が出る", () => {
    renderWithLocale(<AnimeIndexPage seasons={[]} featured={null} />, "en");

    expect(screen.getByText("No anime found")).toBeInTheDocument();
  });

  test("英語表示ではシーズン名が英語の語順になる", () => {
    renderWithLocale(<AnimeIndexPage seasons={SEASONS} featured={FEATURED} />, "en");

    const list = screen.getByRole("list", { name: "Seasons" });
    expect(within(list).getByRole("link", { name: /Fall 2026/ })).toBeInTheDocument();
    expect(featuredSection("Fall 2026 anime")).toBeInTheDocument();
  });
});
