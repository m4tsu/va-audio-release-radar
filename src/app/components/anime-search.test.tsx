import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { AnimeSearch } from "@/app/components/anime-search";
import { LocaleContext } from "@/app/i18n";
import { animeSummary } from "@/app/test/fixtures";

const searchAnimeFn = vi.hoisted(() => vi.fn(async () => [] as unknown[]));

/** server function はブラウザから呼べないので差し替える */
vi.mock("@/app/server-fns/anime", () => ({ searchAnimeFn }));

const ANIME = animeSummary({
  slug: "roshidere",
  titleNative: "時々ボソッとロシア語でデレる隣のアーリャさん",
  titleRomaji: "Tokidoki Bosotto Russia-go de Dereru Tonari no Alya-san",
  titleEnglish: "Alya Sometimes Hides Her Feelings in Russian",
  seasonYear: 2024,
  season: "SUMMER",
  actorCount: 2,
});

describe("AnimeSearch の入力欄", () => {
  test("入力前は例示も結果も出さない", () => {
    render(<AnimeSearch />);

    expect(screen.getByLabelText("アニメ名で検索")).not.toHaveAttribute("placeholder");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  test("英語表示でもラベルが出る", () => {
    render(
      <LocaleContext value="en">
        <AnimeSearch />
      </LocaleContext>,
    );

    expect(screen.getByLabelText("Search by anime title")).not.toHaveAttribute("placeholder");
  });
});

describe("AnimeSearch の結果", () => {
  test("入力すると一致した作品が出て、作品のページへ結ぶ", async () => {
    const user = userEvent.setup();
    searchAnimeFn.mockResolvedValueOnce([ANIME]);
    render(<AnimeSearch />);

    // 略称でも当たる (別名タイトルを引くのはサーバー側)
    await user.type(screen.getByLabelText("アニメ名で検索"), "ロシデレ");

    const link = await screen.findByRole("link", { name: /アーリャさん/ });
    expect(link).toHaveAttribute("href", "/anime/roshidere");
    expect(link).toHaveTextContent("2024 年夏");
    expect(link).toHaveTextContent("音声作品がある出演者 2 人");
  });

  test("一致しなければ、その語で見つからなかったことを出す", async () => {
    const user = userEvent.setup();
    searchAnimeFn.mockResolvedValueOnce([]);
    render(<AnimeSearch />);

    await user.type(screen.getByLabelText("アニメ名で検索"), "存在しない作品");

    expect(
      await screen.findByText("「存在しない作品」に一致するアニメは見つかりませんでした。"),
    ).toBeInTheDocument();
  });
});
