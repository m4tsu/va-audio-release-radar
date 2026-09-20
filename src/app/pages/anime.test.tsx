import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { AnimePage } from "@/app/pages/anime";
import { useFollowStore } from "@/app/store/follow-store";
import { animeCastMember, animeDetail } from "@/app/test/fixtures";
import { readyFollowStore } from "@/app/test/follow";
import { renderWithLocale } from "@/app/test/render";

/**
 * 日本語名と英語名が別の文字列で、役の英語表記 (characterNameFull) は持たない作品。
 * 英語名が無い作品の落とし分けは `lib/anime-title.ts` の単体テストが持つ
 */
const ANIME = animeDetail({
  titleNative: "架空のアニメ",
  titleRomaji: "Kakuu no Anime",
  titleEnglish: "Fictional Anime",
  cast: [
    animeCastMember({
      characterNameNative: "架空キャラ",
      actor: {
        id: "va_alpha",
        slug: "alpha",
        canonicalName: "架空アルファ",
        nameEn: "Kakuu Alpha",
      },
    }),
  ],
});

describe("AnimePage の見出し", () => {
  test("日本語表示では見出しが日本語名、副題がシーズンと英語名", () => {
    renderWithLocale(<AnimePage anime={ANIME} />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("架空のアニメ");
    expect(screen.getByText("2026 年秋 ／ Fictional Anime")).toBeInTheDocument();
  });

  test("英語表示では見出しが英語名、副題が日本語名", () => {
    renderWithLocale(<AnimePage anime={ANIME} />, "en");

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Fictional Anime");
    expect(screen.getByText("Fall 2026 / 架空のアニメ")).toBeInTheDocument();
  });
});

describe("AnimePage の出演者", () => {
  test("役名・役種を出し、声優名から声優ページへ結ぶ", () => {
    renderWithLocale(<AnimePage anime={ANIME} />);

    expect(screen.getByText("架空キャラ")).toBeInTheDocument();
    expect(screen.getByText("主演")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "架空アルファ" })).toHaveAttribute(
      "href",
      "/voice-actors/alpha",
    );
  });

  /** 役の英語表記が無い出演は、英語表示でも日本語の役名のまま出る (名前が消えない) */
  test("英語表示では声優名がローマ字になり、英語表記の無い役名は日本語のまま残る", () => {
    renderWithLocale(<AnimePage anime={ANIME} />, "en");

    expect(screen.getByText("架空キャラ")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Kakuu Alpha" })).toBeInTheDocument();
  });

  test("媒体別の作品数を出す", () => {
    renderWithLocale(<AnimePage anime={ANIME} />);

    expect(screen.getByText("ASMR 2")).toBeInTheDocument();
  });

  test("媒体別の内訳が無ければ、あることだけを言う", () => {
    const anime = animeDetail({ cast: [animeCastMember({ workCounts: [] })] });
    renderWithLocale(<AnimePage anime={anime} />);

    expect(screen.getByText("音声作品あり")).toBeInTheDocument();
  });
});

/**
 * アニメから入った人が声優ページへ移らずに登録を終えられること。
 * 保存そのものは follow-button と follow-store のテストが見る
 */
describe("AnimePage のフォロー", () => {
  test("キャストの行からフォローでき、同じ行から解除できる", async () => {
    const user = userEvent.setup();
    await readyFollowStore();
    renderWithLocale(<AnimePage anime={ANIME} />);

    await user.click(screen.getByRole("button", { name: "フォロー" }));

    expect(screen.getByRole("button", { name: "フォロー中" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(useFollowStore.getState().isFollowing("va_alpha")).toBe(true);

    await user.click(screen.getByRole("button", { name: "フォロー中" }));

    expect(useFollowStore.getState().isFollowing("va_alpha")).toBe(false);
  });

  /** ボタンがリンクの中にあると、押したときに声優ページへ移ってしまう */
  test("フォローのボタンは声優ページへのリンクの中に無い", async () => {
    await readyFollowStore();
    renderWithLocale(<AnimePage anime={ANIME} />);

    const button = screen.getByRole("button", { name: "フォロー" });
    expect(button.closest("a")).toBeNull();
  });
});
