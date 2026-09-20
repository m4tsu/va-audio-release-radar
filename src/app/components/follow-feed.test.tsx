import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { FollowFeed } from "@/app/components/follow-feed";
import { useFollowStore } from "@/app/store/follow-store";
import { feedItem, workSummary } from "@/app/test/fixtures";
import { readyFollowStore } from "@/app/test/follow";
import { renderWithLocale } from "@/app/test/render";

type FeedItems = ReturnType<typeof feedItem>[];
const fetchFeed = vi.fn<(input: unknown) => Promise<FeedItems>>(async () => []);
vi.mock("@/app/server-fns/works", () => ({ fetchFeed: (input: unknown) => fetchFeed(input) }));

const ALPHA = { voiceActorId: "va_alpha", slug: "alpha", canonicalName: "架空アルファ" };

const UPCOMING = feedItem({
  work: workSummary({ id: "audible:B1", title: "架空の発売予定作品" }),
  freshness: "upcoming",
});
const RECENT = feedItem({
  work: workSummary({ id: "dlsite:RJ1", title: "架空の新作" }),
  freshness: "recent",
});
const OLDER = feedItem({
  work: workSummary({ id: "dlsite:RJ2", title: "架空の旧作" }),
  freshness: "older",
});

beforeEach(() => {
  fetchFeed.mockReset();
  fetchFeed.mockResolvedValue([]);
});

/** フォロー 1 人ぶんの状態を作ってから描く。0 件では取りに行かない */
async function renderFeed(items: FeedItems, locale?: "ja" | "en") {
  fetchFeed.mockResolvedValue(items);
  await readyFollowStore();
  await useFollowStore.getState().follow(ALPHA);
  return renderWithLocale(<FollowFeed />, locale);
}

describe("FollowFeed の取得", () => {
  test("フォロー中の声優 ID をまとめて送る", async () => {
    await renderFeed([]);

    expect(fetchFeed).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ voiceActorIds: ["va_alpha"] }) }),
    );
  });

  test("取得に失敗したら、次にすべきことを添えて出す", async () => {
    fetchFeed.mockRejectedValue(new Error("架空の失敗"));
    await readyFollowStore();
    await useFollowStore.getState().follow(ALPHA);
    renderWithLocale(<FollowFeed />);

    expect(await screen.findByText("新着を読み込めませんでした")).toBeInTheDocument();
    expect(screen.getByText("しばらくしてから再読み込みしてください。")).toBeInTheDocument();
  });

  test("1 件も無ければ、期間内に無いことを言い、声優を探す導線を出す", async () => {
    await renderFeed([]);

    expect(await screen.findByText("この期間の新着はありません")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "声優を探す" })).toHaveAttribute(
      "href",
      "/voice-actors",
    );
  });
});

describe("FollowFeed の段分け", () => {
  test("発売予定・30 日以内・それより前の 3 段に分かれる", async () => {
    await renderFeed([UPCOMING, RECENT, OLDER]);

    expect(
      await screen.findByRole("heading", { level: 2, name: /今後の発売/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /30 日以内の新作/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /それより前/ })).toBeInTheDocument();
  });

  test("該当する作品が無い段は見出しごと出さない", async () => {
    await renderFeed([RECENT]);

    expect(
      await screen.findByRole("heading", { level: 2, name: /30 日以内の新作/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: /今後の発売/ })).not.toBeInTheDocument();
  });

  test("段の見出しにその段の件数を添える", async () => {
    await renderFeed([RECENT, OLDER]);

    const recent = await screen.findByRole("heading", { level: 2, name: /30 日以内の新作/ });
    expect(recent).toHaveTextContent("1 作品");
  });

  /** 3 段目は件数が多く、目的は取りこぼしの確認なので既定では畳んでおく */
  test("上の段があれば 3 段目は畳まれていて、押すと開く", async () => {
    const user = userEvent.setup();
    await renderFeed([RECENT, OLDER]);

    const toggle = await screen.findByRole("button", { name: /それより前/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "架空の旧作" })).not.toBeInTheDocument();

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "架空の旧作" })).toBeInTheDocument();
  });

  /** 上 2 段が空のまま畳んでおくと、作品があるのに画面が空に見える */
  test("3 段目しか無いときは最初から開いている", async () => {
    await renderFeed([OLDER]);

    expect(await screen.findByRole("button", { name: /それより前/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("link", { name: "架空の旧作" })).toBeInTheDocument();
  });
});
