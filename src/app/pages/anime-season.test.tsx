import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { LocaleContext } from "@/app/i18n";
import { AnimeSeasonPage } from "@/app/pages/anime-season";
import { useFollowStore } from "@/app/store/follow-store";
import { seasonAnime } from "@/app/test/fixtures";
import { readyFollowStore } from "@/app/test/follow";
import { renderWithLocale } from "@/app/test/render";

const ANIME = seasonAnime({
  slug: "kakuu-no-anime",
  titleNative: "架空のアニメ",
  titleEnglish: "Fictional Anime",
  actorCount: 3,
  actorIds: ["va_alpha", "va_beta"],
});

const OTHER = seasonAnime({
  slug: "mou-hitotsu-no-anime",
  titleNative: "もう一つのアニメ",
  titleEnglish: "Another Anime",
  actorCount: 1,
  actorIds: ["va_gamma"],
});

const ALPHA = { voiceActorId: "va_alpha", slug: "alpha", canonicalName: "架空アルファ" };

describe("AnimeSeasonPage の一覧", () => {
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

describe("AnimeSeasonPage の並べ替え", () => {
  /** サーバーは人気の高い順で渡す。並べ替えていない画面はその順のまま出す */
  const BY_POPULARITY = [ANIME, OTHER];
  const links = () => screen.getAllByRole("link", { name: /アニメ/ });

  test("何も操作していない状態はサーバーが渡した順 (人気順)", () => {
    renderWithLocale(<AnimeSeasonPage anime={BY_POPULARITY} seasonYear={2026} season="FALL" />);

    expect(links().map((link) => link.textContent)).toEqual([
      expect.stringContaining("架空のアニメ"),
      expect.stringContaining("もう一つのアニメ"),
    ]);
  });

  test("出演者の多い順に変えると並びが変わる", async () => {
    const user = userEvent.setup();
    // 人気順では出演者 1 人の作品が先に来る並びを渡し、切り替えで入れ替わることを見る
    renderWithLocale(<AnimeSeasonPage anime={[OTHER, ANIME]} seasonYear={2026} season="FALL" />);

    await user.click(screen.getByRole("combobox", { name: "並び替え: 人気順" }));
    await user.click(screen.getByRole("option", { name: "音声作品がある出演者の多い順" }));

    expect(links()[0]).toHaveTextContent("架空のアニメ");
  });

  test("人気順へ戻せる", async () => {
    const user = userEvent.setup();
    renderWithLocale(<AnimeSeasonPage anime={[OTHER, ANIME]} seasonYear={2026} season="FALL" />);

    await user.click(screen.getByRole("combobox", { name: "並び替え: 人気順" }));
    await user.click(screen.getByRole("option", { name: "音声作品がある出演者の多い順" }));
    await user.click(
      screen.getByRole("combobox", { name: "並び替え: 音声作品がある出演者の多い順" }),
    );
    await user.click(screen.getByRole("option", { name: "人気順" }));

    expect(links()[0]).toHaveTextContent("もう一つのアニメ");
  });

  /** 「一覧を開き直すと既定に戻る」は、前後のシーズンをたどった先でも成り立つ必要がある */
  test("シーズンを移ると並べ替えが既定に戻る", async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithLocale(
      <AnimeSeasonPage anime={[OTHER, ANIME]} seasonYear={2026} season="FALL" />,
    );

    await user.click(screen.getByRole("combobox", { name: "並び替え: 人気順" }));
    await user.click(screen.getByRole("option", { name: "音声作品がある出演者の多い順" }));
    expect(links()[0]).toHaveTextContent("架空のアニメ");

    // renderWithLocale の Provider ごと差し替える (rerender は根の要素を置き換えるため)
    rerender(
      <LocaleContext value="ja">
        <AnimeSeasonPage anime={[OTHER, ANIME]} seasonYear={2026} season="SUMMER" />
      </LocaleContext>,
    );

    expect(screen.getByRole("combobox", { name: "並び替え: 人気順" })).toBeInTheDocument();
    expect(links()[0]).toHaveTextContent("もう一つのアニメ");
  });

  test("作品が 1 件も無ければ並べ替えを出さない", () => {
    renderWithLocale(<AnimeSeasonPage anime={[]} seasonYear={2026} season="FALL" />);

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});

describe("AnimeSeasonPage の前後のシーズン", () => {
  test("隣のシーズンがあれば、その一覧へ結ぶ", () => {
    renderWithLocale(
      <AnimeSeasonPage
        anime={[ANIME]}
        seasonYear={2026}
        season="FALL"
        older={{ seasonYear: 2026, season: "SUMMER" }}
        newer={{ seasonYear: 2027, season: "WINTER" }}
      />,
    );

    expect(screen.getByRole("link", { name: "前のシーズン (2026 年夏)" })).toHaveAttribute(
      "href",
      "/anime/season/2026-summer",
    );
    expect(screen.getByRole("link", { name: "次のシーズン (2027 年冬)" })).toHaveAttribute(
      "href",
      "/anime/season/2027-winter",
    );
  });

  test("いちばん古い / 新しいシーズンでは、その向きの導線を出さない", () => {
    renderWithLocale(<AnimeSeasonPage anime={[ANIME]} seasonYear={2026} season="FALL" />);

    expect(screen.queryByRole("link", { name: /前のシーズン/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /次のシーズン/ })).not.toBeInTheDocument();
    // 索引へ戻る導線はどのシーズンでも出す
    expect(screen.getByRole("link", { name: "すべてのシーズン" })).toHaveAttribute(
      "href",
      "/anime",
    );
  });
});

describe("AnimeSeasonPage のフォロー中の印", () => {
  test("フォローが 1 件も無ければ、印も絞り込みも出さない", async () => {
    await readyFollowStore();
    renderWithLocale(<AnimeSeasonPage anime={[ANIME, OTHER]} seasonYear={2026} season="FALL" />);

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByText("フォロー中の声優が出演")).not.toBeInTheDocument();
  });

  test("フォロー中の声優が出ている作品に印を付ける", async () => {
    await readyFollowStore();
    await useFollowStore.getState().follow(ALPHA);
    renderWithLocale(<AnimeSeasonPage anime={[ANIME, OTHER]} seasonYear={2026} season="FALL" />);

    expect(screen.getAllByText("フォロー中の声優が出演")).toHaveLength(1);
    expect(screen.getByRole("link", { name: /架空のアニメ/ })).toHaveTextContent(
      "フォロー中の声優が出演",
    );
  });

  test("絞り込むと、フォロー中の声優が出ている作品だけが残る", async () => {
    const user = userEvent.setup();
    await readyFollowStore();
    await useFollowStore.getState().follow(ALPHA);
    renderWithLocale(<AnimeSeasonPage anime={[ANIME, OTHER]} seasonYear={2026} season="FALL" />);

    await user.click(screen.getByRole("checkbox", { name: "フォロー中の声優が出ている作品だけ" }));

    expect(screen.getByRole("link", { name: /架空のアニメ/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /もう一つのアニメ/ })).not.toBeInTheDocument();
  });

  test("絞り込んだ結果が 0 件なら、そのことを言う", async () => {
    const user = userEvent.setup();
    await readyFollowStore();
    await useFollowStore.getState().follow(ALPHA);
    renderWithLocale(<AnimeSeasonPage anime={[OTHER]} seasonYear={2026} season="FALL" />);

    await user.click(screen.getByRole("checkbox", { name: "フォロー中の声優が出ている作品だけ" }));

    expect(screen.getByText("フォロー中の声優が出ている作品はありません")).toBeInTheDocument();
  });
});
