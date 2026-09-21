import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { FollowingPage } from "@/app/pages/following";
import { useFollowStore } from "@/app/store/follow-store";
import { usePushStore } from "@/app/store/push-store";
import { animeSummary, feedItem, workSummary } from "@/app/test/fixtures";
import { readyFollowStore } from "@/app/test/follow";
import { renderWithLocale } from "@/app/test/render";

/** フィードの中身は follow-feed.test.tsx が見る。ここでは呼ばれても空を返させる */
const fetchFeed = vi.fn<(input: unknown) => Promise<ReturnType<typeof feedItem>[]>>(async () => []);
/** 最新リリースの中身は follow-manager.test.tsx が見る */
vi.mock("@/app/server-fns/works", () => ({
  fetchFeed: (input: unknown) => fetchFeed(input),
  fetchWorkStatsForActors: async () => [],
}));

/** 出演アニメの中身は followed-anime.test.tsx が見る。ここでは区画が出ることだけ */
const fetchAnimeForActors = vi.fn<(input: unknown) => Promise<ReturnType<typeof animeSummary>[]>>(
  async () => [],
);
vi.mock("@/app/server-fns/anime", () => ({
  fetchAnimeForActors: (input: unknown) => fetchAnimeForActors(input),
}));

/** 通知の購読の段取りは push-store.test.ts が見る。ここでは区画が出る条件だけ */
vi.mock("@/app/server-fns/push", () => ({
  savePushSubscriptionFn: vi.fn(),
  deletePushSubscriptionFn: vi.fn(),
}));

const ALPHA = {
  voiceActorId: "va_alpha",
  slug: "alpha",
  canonicalName: "架空アルファ",
  nameEn: "Kakuu Alpha",
};

beforeEach(() => {
  fetchFeed.mockClear();
  fetchAnimeForActors.mockClear();
  fetchAnimeForActors.mockResolvedValue([]);
});

describe("FollowingPage の状態", () => {
  test("読み込みが済むまでは読み込み中と出し、空とは言わない", () => {
    renderWithLocale(<FollowingPage vapidPublicKey={null} />);

    expect(screen.getByText("読み込み中…")).toBeInTheDocument();
    expect(screen.queryByText("まだ誰もフォローしていません")).not.toBeInTheDocument();
  });

  test("フォローが 0 件なら、声優を探す導線を出す", async () => {
    await readyFollowStore();
    renderWithLocale(<FollowingPage vapidPublicKey={null} />);

    expect(screen.getByText("まだ誰もフォローしていません")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "声優を探す" })).toHaveAttribute(
      "href",
      "/voice-actors",
    );
  });
});

describe("FollowingPage の通知", () => {
  /** 先に購読しておいて後からフォローする順でも成立させるため、0 件でも区画を出す */
  test("フォローが 0 件でも、公開鍵があれば通知の区画を出す", async () => {
    usePushStore.setState({ status: "unsubscribed" });
    await readyFollowStore();
    renderWithLocale(<FollowingPage vapidPublicKey="BExampleKey" />);

    expect(screen.getByRole("heading", { name: "新作の通知" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新作の通知を受け取る" })).toBeInTheDocument();
    expect(screen.getByText("まだ誰もフォローしていません")).toBeInTheDocument();
  });

  test("公開鍵が無ければ通知の区画は出ない", async () => {
    usePushStore.setState({ status: "unsubscribed" });
    await readyFollowStore();
    await useFollowStore.getState().follow(ALPHA);
    renderWithLocale(<FollowingPage vapidPublicKey={null} />);

    expect(screen.queryByRole("heading", { name: "新作の通知" })).not.toBeInTheDocument();
  });

  test("読み込みが済むまでは通知の区画も出さない", () => {
    usePushStore.setState({ status: "unsubscribed" });
    renderWithLocale(<FollowingPage vapidPublicKey="BExampleKey" />);

    expect(screen.queryByRole("heading", { name: "新作の通知" })).not.toBeInTheDocument();
  });
});

/** 管理の中身 (名前・最新リリース・解除) は follow-manager.test.tsx が見る */
describe("FollowingPage のフォロー管理", () => {
  test("フォローが 1 人でもいれば管理の区画を出す", async () => {
    await readyFollowStore();
    await useFollowStore.getState().follow(ALPHA);
    renderWithLocale(<FollowingPage vapidPublicKey={null} />);

    const list = screen.getByRole("list", { name: "フォロー中の声優" });
    expect(within(list).getByRole("link", { name: "架空アルファ" })).toBeInTheDocument();
  });
});

describe("FollowingPage のフィード", () => {
  test("フォローが 1 人でもいればフィードを引く", async () => {
    await readyFollowStore();
    await useFollowStore.getState().follow(ALPHA);
    renderWithLocale(<FollowingPage vapidPublicKey={null} />);

    expect(fetchFeed).toHaveBeenCalled();
  });

  test("フォローが 0 件ならフィードを引かない", async () => {
    await readyFollowStore();
    renderWithLocale(<FollowingPage vapidPublicKey={null} />);

    expect(fetchFeed).not.toHaveBeenCalled();
  });

  test("フィードが空でも、取りこぼしではなく期間内に無いことを言う", async () => {
    await readyFollowStore();
    await useFollowStore.getState().follow(ALPHA);
    renderWithLocale(<FollowingPage vapidPublicKey={null} />);

    expect(await screen.findByText("この期間の新着はありません")).toBeInTheDocument();
  });

  test("フォロー中の声優が出ているアニメを作品の後ろに並べる", async () => {
    fetchAnimeForActors.mockResolvedValue([
      animeSummary({ slug: "kakuu-no-anime", titleNative: "架空のアニメ" }),
    ]);
    await readyFollowStore();
    await useFollowStore.getState().follow(ALPHA);
    renderWithLocale(<FollowingPage vapidPublicKey={null} />);

    expect(
      await screen.findByRole("heading", { name: "フォロー中の声優が出ているアニメ" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /架空のアニメ/ })).toHaveAttribute(
      "href",
      "/anime/kakuu-no-anime",
    );
  });

  test("引けた作品はカードとして並ぶ", async () => {
    fetchFeed.mockResolvedValueOnce([
      feedItem({ work: workSummary({ title: "架空の新着作品" }), freshness: "recent" }),
    ]);
    await readyFollowStore();
    await useFollowStore.getState().follow(ALPHA);
    renderWithLocale(<FollowingPage vapidPublicKey={null} />);

    expect(await screen.findByRole("link", { name: "架空の新着作品" })).toBeInTheDocument();
  });
});
