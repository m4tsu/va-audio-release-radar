import { screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { AnimeIndexPage } from "@/app/pages/anime-index";
import { animeSeasonEntry } from "@/app/test/fixtures";
import { renderWithLocale } from "@/app/test/render";

const SEASONS = [
  animeSeasonEntry({ seasonYear: 2026, season: "FALL", animeCount: 12 }),
  animeSeasonEntry({ seasonYear: 2026, season: "SUMMER", animeCount: 9 }),
  animeSeasonEntry({ seasonYear: 2024, season: "WINTER", animeCount: 4 }),
];

describe("AnimeIndexPage", () => {
  test("シーズンを並べ、それぞれのシーズン一覧へ結ぶ", () => {
    renderWithLocale(<AnimeIndexPage seasons={SEASONS} />);

    const list = screen.getByRole("list", { name: "シーズン" });
    expect(within(list).getAllByRole("link")).toHaveLength(3);

    const link = within(list).getByRole("link", { name: /2026 年秋/ });
    expect(link).toHaveAttribute("href", "/anime/season/2026-fall");
    expect(link).toHaveTextContent("12 作品");
  });

  /** 渡された並び (新しい順) をそのまま出す。並べ替えはサーバーが決める */
  test("受け取った順に並べる", () => {
    renderWithLocale(<AnimeIndexPage seasons={SEASONS} />);

    const links = within(screen.getByRole("list", { name: "シーズン" })).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/anime/season/2026-fall",
      "/anime/season/2026-summer",
      "/anime/season/2024-winter",
    ]);
  });

  test("出せるシーズンが 1 つも無ければ、アニメが無いことを言う", () => {
    renderWithLocale(<AnimeIndexPage seasons={[]} />);

    expect(screen.getByText("アニメがありません")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "シーズン" })).not.toBeInTheDocument();
  });

  test("英語表示でも本文が出る", () => {
    renderWithLocale(<AnimeIndexPage seasons={[]} />, "en");

    expect(screen.getByText("No anime found")).toBeInTheDocument();
  });

  test("英語表示ではシーズン名が英語の語順になる", () => {
    renderWithLocale(<AnimeIndexPage seasons={SEASONS} />, "en");

    const list = screen.getByRole("list", { name: "Seasons" });
    expect(within(list).getByRole("link", { name: /Fall 2026/ })).toBeInTheDocument();
  });
});
