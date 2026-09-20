import { screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { AnimeSeasonPage } from "@/app/pages/anime-season";
import { animeSummary } from "@/app/test/fixtures";
import { renderWithLocale } from "@/app/test/render";

const ANIME = animeSummary({
  slug: "kakuu-no-anime",
  titleNative: "架空のアニメ",
  titleEnglish: "Fictional Anime",
  actorCount: 3,
});

describe("AnimeSeasonPage", () => {
  test("見出しにシーズンを入れ、作品をアニメのページへ結ぶ", () => {
    renderWithLocale(<AnimeSeasonPage anime={[ANIME]} seasonYear={2026} season="FALL" />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("2026 年秋アニメ");
    const link = screen.getByRole("link", { name: /架空のアニメ/ });
    expect(link).toHaveAttribute("href", "/anime/kakuu-no-anime");
    expect(link).toHaveTextContent("音声作品がある出演者 3 人");
  });

  test("そのシーズンに作品が無ければ空表示を出す", () => {
    renderWithLocale(<AnimeSeasonPage anime={[]} seasonYear={2026} season="FALL" />);

    expect(screen.getByText("2026 年秋のアニメはありません")).toBeInTheDocument();
  });

  /** 英語表示では一覧のアニメ名も英語名になり、日本語名は出さない */
  test("英語表示ではアニメ名が英語名になる", () => {
    renderWithLocale(<AnimeSeasonPage anime={[ANIME]} seasonYear={2026} season="FALL" />, "en");

    expect(screen.getByRole("link", { name: /Fictional Anime/ })).toBeInTheDocument();
    expect(screen.queryByText("架空のアニメ")).not.toBeInTheDocument();
  });
});
