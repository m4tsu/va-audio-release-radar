import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { HomePage, type StoreWorks } from "@/app/pages/home";
import { latestWork, workSummary } from "@/app/test/fixtures";
import { readyFollowStore } from "@/app/test/follow";
import { renderWithLocale } from "@/app/test/render";

/** 検索欄はサーバーを呼ぶ。この画面で見たいのは新着なので、呼び先だけ差し替える */
vi.mock("@/app/server-fns/actors", () => ({ searchActorsFn: vi.fn(async () => []) }));

const ASMR = latestWork({
  work: workSummary({ id: "dlsite:RJ1", title: "架空のASMR作品" }),
  actors: [{ id: "va_alpha", slug: "alpha", name: "架空アルファ" }],
});
const AUDIOBOOK = latestWork({
  work: workSummary({ id: "audible:B1", title: "架空の朗読作品", category: "audiobook" }),
  actors: [],
});

/** ポケドラは作品なし。空のタブでも画面が壊れないことを見る */
const LATEST: StoreWorks[] = [
  { storeSlug: "dlsite", items: [ASMR] },
  { storeSlug: "audible", items: [AUDIOBOOK] },
  { storeSlug: "pokedora", items: [] },
];

function tabs() {
  return screen.getByRole("tablist", { name: "ストアで絞り込む" });
}

describe("HomePage の新着タブ", () => {
  test("既定のタブは DLsite で、そのストアの作品だけを出す", () => {
    renderWithLocale(<HomePage latestByStore={LATEST} />);

    expect(within(tabs()).getByRole("tab", { name: "DLsite" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("link", { name: "架空のASMR作品" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "架空の朗読作品" })).not.toBeInTheDocument();
  });

  test("タブを押すとそのストアの作品に入れ替わる", async () => {
    const user = userEvent.setup();
    renderWithLocale(<HomePage latestByStore={LATEST} />);

    await user.click(within(tabs()).getByRole("tab", { name: "Audible" }));

    expect(screen.getByRole("link", { name: "架空の朗読作品" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "架空のASMR作品" })).not.toBeInTheDocument();
  });

  test("作品が 1 件も無いストアのタブでも空表示が出る", async () => {
    const user = userEvent.setup();
    renderWithLocale(<HomePage latestByStore={LATEST} />);

    await user.click(within(tabs()).getByRole("tab", { name: "ポケドラ" }));

    expect(screen.getByText("ポケドラ の新着はありません")).toBeInTheDocument();
  });

  /** WAI-ARIA の tabs の作法。選択中のタブだけがタブ順に入り、移動は矢印キーで行う */
  test("選択中のタブだけが tabIndex 0 を持つ", () => {
    renderWithLocale(<HomePage latestByStore={LATEST} />);

    const focusable = within(tabs())
      .getAllByRole("tab")
      .filter((tab) => tab.getAttribute("tabindex") === "0");
    expect(focusable.map((tab) => tab.textContent)).toEqual(["DLsite"]);
  });

  test("→ で次のタブへ、端では先頭へ回る", async () => {
    const user = userEvent.setup();
    renderWithLocale(<HomePage latestByStore={LATEST} />);

    within(tabs()).getByRole("tab", { name: "DLsite" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(within(tabs()).getByRole("tab", { name: "Audible" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(within(tabs()).getByRole("tab", { name: "DLsite" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("← で前のタブへ、先頭では末尾へ回る", async () => {
    const user = userEvent.setup();
    renderWithLocale(<HomePage latestByStore={LATEST} />);

    within(tabs()).getByRole("tab", { name: "DLsite" }).focus();
    await user.keyboard("{ArrowLeft}");

    expect(within(tabs()).getByRole("tab", { name: "ポケドラ" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

describe("HomePage の中身", () => {
  test("見出しと、名前を知らない人向けの入口を出す", () => {
    renderWithLocale(<HomePage latestByStore={LATEST} />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "好きな声優の声が聴ける作品を見つける",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "声優から探す" })).toHaveAttribute(
      "href",
      "/voice-actors",
    );
    expect(screen.getByRole("link", { name: "アニメから探す" })).toHaveAttribute("href", "/anime");
  });

  test("新着のカードは出演声優を声優ページへ結ぶ", () => {
    renderWithLocale(<HomePage latestByStore={LATEST} />);

    expect(screen.getByRole("link", { name: "架空アルファ" })).toHaveAttribute(
      "href",
      "/voice-actors/alpha",
    );
  });
});

describe("HomePage のフォロー中への導線", () => {
  test("フォローが 0 件なら出さない", async () => {
    await readyFollowStore();
    renderWithLocale(<HomePage latestByStore={LATEST} />);

    expect(screen.queryByRole("link", { name: "フォロー中の新着" })).not.toBeInTheDocument();
  });

  test("フォローが 1 件でもあれば出す", async () => {
    await readyFollowStore();
    const { useFollowStore } = await import("@/app/store/follow-store");
    await useFollowStore
      .getState()
      .follow({ voiceActorId: "va_alpha", slug: "alpha", canonicalName: "架空アルファ" });

    renderWithLocale(<HomePage latestByStore={LATEST} />);

    expect(screen.getByRole("link", { name: "フォロー中の新着" })).toHaveAttribute(
      "href",
      "/following",
    );
  });
});
