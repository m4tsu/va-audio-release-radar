import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { FollowManager } from "@/app/components/follow-manager";
import type { ActorWorkStats } from "@/app/lib/view-types";
import { useFollowStore } from "@/app/store/follow-store";
import { readyFollowStore } from "@/app/test/follow";
import { renderWithLocale } from "@/app/test/render";

const fetchWorkStatsForActors = vi.fn<(input: unknown) => Promise<ActorWorkStats[]>>(
  async () => [],
);
vi.mock("@/app/server-fns/works", () => ({
  fetchWorkStatsForActors: (input: unknown) => fetchWorkStatsForActors(input),
}));

const ALPHA = {
  voiceActorId: "va_alpha",
  slug: "alpha",
  canonicalName: "架空アルファ",
  nameEn: "Kakuu Alpha",
};

const BETA = { voiceActorId: "va_beta", slug: "beta", canonicalName: "架空ベータ" };

beforeEach(() => {
  fetchWorkStatsForActors.mockClear();
  fetchWorkStatsForActors.mockResolvedValue([]);
});

describe("FollowManager の一覧", () => {
  test("フォロー中の声優を並べ、声優ページへ結ぶ", async () => {
    await readyFollowStore();
    await useFollowStore.getState().follow(ALPHA);
    renderWithLocale(<FollowManager />);

    const list = screen.getByRole("list", { name: "フォロー中の声優" });
    expect(within(list).getByRole("link", { name: "架空アルファ" })).toHaveAttribute(
      "href",
      "/voice-actors/alpha",
    );
    expect(
      screen.getByRole("heading", { level: 2, name: /フォロー中の声優 1 人/ }),
    ).toBeInTheDocument();
  });

  test("解除するとその声優が一覧から消える", async () => {
    const user = userEvent.setup();
    await readyFollowStore();
    await useFollowStore.getState().follow(ALPHA);
    renderWithLocale(<FollowManager />);

    await user.click(screen.getByRole("button", { name: "架空アルファのフォローを解除" }));

    expect(screen.queryByRole("link", { name: "架空アルファ" })).not.toBeInTheDocument();
  });

  test("このブラウザにしか無いことは、常には出さずヘルプの印の中に置く", async () => {
    const user = userEvent.setup();
    await readyFollowStore();
    await useFollowStore.getState().follow(ALPHA);
    renderWithLocale(<FollowManager />);

    expect(screen.queryByText("このブラウザにのみ保存されます")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "フォローの保存先の説明" }));

    expect(screen.getByRole("dialog", { name: "フォローの保存先の説明" })).toHaveTextContent(
      "このブラウザにのみ保存されます",
    );
  });

  /**
   * 一覧の名前は保存した行だけで描く (サーバーに引き直さない)。
   * ローマ字がその行に入っていることをこの経路で確かめる
   */
  test("英語表示ではローマ字で出し、持たない声優は漢字表記のまま出す", async () => {
    await readyFollowStore();
    await useFollowStore.getState().follow(ALPHA);
    await useFollowStore.getState().follow(BETA);
    renderWithLocale(<FollowManager />, "en");

    const list = screen.getByRole("list", { name: "Voice actors you follow" });
    expect(within(list).getByRole("link", { name: "Kakuu Alpha" })).toBeInTheDocument();
    expect(within(list).getByRole("link", { name: "架空ベータ" })).toBeInTheDocument();
  });
});

/** フォローしても当面は何も届かない声優が多いので、最後に出したのがいつかを名前の隣に出す */
describe("FollowManager の最新リリース", () => {
  test("フォロー中の声優 ID を送って引く", async () => {
    await readyFollowStore();
    await useFollowStore.getState().follow(ALPHA);
    renderWithLocale(<FollowManager />);

    expect(fetchWorkStatsForActors).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ voiceActorIds: ["va_alpha"] }) }),
    );
  });

  test("声優ごとに最後の新作の年月を出す", async () => {
    fetchWorkStatsForActors.mockResolvedValue([
      { voiceActorId: "va_alpha", workCount: 3, latestReleaseDate: "2026-09-18" },
      { voiceActorId: "va_beta", workCount: 1, latestReleaseDate: "2024-01-05" },
    ]);
    await readyFollowStore();
    await useFollowStore.getState().follow(ALPHA);
    await useFollowStore.getState().follow(BETA);
    renderWithLocale(<FollowManager />);

    expect(await screen.findByText("2026年9月")).toBeInTheDocument();
    expect(screen.getByText("2024年1月")).toBeInTheDocument();
  });

  /** 年月だけでは何の日付か分からない。読み上げには名前を添える */
  test("年月には読み上げ用の名前を添える", async () => {
    fetchWorkStatsForActors.mockResolvedValue([
      { voiceActorId: "va_alpha", workCount: 3, latestReleaseDate: "2026-09-18" },
    ]);
    await readyFollowStore();
    await useFollowStore.getState().follow(ALPHA);
    renderWithLocale(<FollowManager />);

    expect(await screen.findByText("最新リリース")).toBeInTheDocument();
  });

  /** 作品がまだ 1 件も無い声優もフォローできる。日付は出しようがない */
  test("作品が無い声優には年月を出さない", async () => {
    await readyFollowStore();
    await useFollowStore.getState().follow(ALPHA);
    renderWithLocale(<FollowManager />);

    await vi.waitFor(() => expect(fetchWorkStatsForActors).toHaveBeenCalled());
    expect(screen.queryByText("最新リリース")).not.toBeInTheDocument();
  });

  test("引けなかったときは名前だけを出す", async () => {
    fetchWorkStatsForActors.mockRejectedValue(new Error("失敗"));
    await readyFollowStore();
    await useFollowStore.getState().follow(ALPHA);
    renderWithLocale(<FollowManager />);

    await vi.waitFor(() => expect(fetchWorkStatsForActors).toHaveBeenCalled());
    expect(screen.getByRole("link", { name: "架空アルファ" })).toBeInTheDocument();
    expect(screen.queryByText("最新リリース")).not.toBeInTheDocument();
  });
});
