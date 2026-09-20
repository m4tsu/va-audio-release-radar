import { screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { AnimeIndexPage } from "@/app/pages/anime-index";
import { renderWithLocale } from "@/app/test/render";

/** 送り先のシーズンが 1 つも無いときだけ描かれる画面 */
describe("AnimeIndexPage", () => {
  test("アニメが 1 本も無いことを言う", () => {
    renderWithLocale(<AnimeIndexPage />);

    expect(screen.getByText("アニメがありません")).toBeInTheDocument();
  });

  test("英語表示でも本文が出る", () => {
    renderWithLocale(<AnimeIndexPage />, "en");

    expect(screen.getByText("No anime found")).toBeInTheDocument();
  });
});
