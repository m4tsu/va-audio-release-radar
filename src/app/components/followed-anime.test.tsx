import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { FollowedAnime } from "@/app/components/followed-anime";
import { useFollowStore } from "@/app/store/follow-store";
import { animeSummary } from "@/app/test/fixtures";
import { readyFollowStore } from "@/app/test/follow";
import { renderWithLocale } from "@/app/test/render";

const fetchAnimeForActors = vi.fn<(input: unknown) => Promise<ReturnType<typeof animeSummary>[]>>(
  async () => [],
);
vi.mock("@/app/server-fns/anime", () => ({
  fetchAnimeForActors: (input: unknown) => fetchAnimeForActors(input),
}));

const ALPHA = { voiceActorId: "va_alpha", slug: "alpha", canonicalName: "架空アルファ" };

beforeEach(() => {
  fetchAnimeForActors.mockClear();
  fetchAnimeForActors.mockResolvedValue([]);
});

describe("FollowedAnime", () => {
  test("フォロー中の声優 ID を送って引く", async () => {
    await readyFollowStore();
    await useFollowStore.getState().follow(ALPHA);
    renderWithLocale(<FollowedAnime />);

    expect(fetchAnimeForActors).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ voiceActorIds: ["va_alpha"] }) }),
    );
  });

  test("フォローが 0 件なら引かない", async () => {
    await readyFollowStore();
    renderWithLocale(<FollowedAnime />);

    expect(fetchAnimeForActors).not.toHaveBeenCalled();
  });

  test("引けたアニメを並べ、アニメのページへ結ぶ", async () => {
    fetchAnimeForActors.mockResolvedValue([
      animeSummary({ slug: "kakuu-no-anime", titleNative: "架空のアニメ" }),
    ]);
    await readyFollowStore();
    await useFollowStore.getState().follow(ALPHA);
    renderWithLocale(<FollowedAnime />);

    expect(
      await screen.findByRole("heading", { name: "フォロー中の声優が出ているアニメ" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /架空のアニメ/ })).toHaveAttribute(
      "href",
      "/anime/kakuu-no-anime",
    );
  });

  /** シーズンをまたいで並ぶので、どの期の作品かがカードから分かる必要がある */
  test("カードにシーズンを添える", async () => {
    fetchAnimeForActors.mockResolvedValue([animeSummary({ seasonYear: 2026, season: "FALL" })]);
    await readyFollowStore();
    await useFollowStore.getState().follow(ALPHA);
    renderWithLocale(<FollowedAnime />);

    expect(await screen.findByText("2026 年秋")).toBeInTheDocument();
  });

  test("出ているアニメが 1 本も無ければ区画ごと出さない", async () => {
    await readyFollowStore();
    await useFollowStore.getState().follow(ALPHA);
    const { container } = renderWithLocale(<FollowedAnime />);

    await vi.waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  test("引けなかったときは何も出さない", async () => {
    fetchAnimeForActors.mockRejectedValue(new Error("失敗"));
    await readyFollowStore();
    await useFollowStore.getState().follow(ALPHA);
    const { container } = renderWithLocale(<FollowedAnime />);

    await vi.waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
