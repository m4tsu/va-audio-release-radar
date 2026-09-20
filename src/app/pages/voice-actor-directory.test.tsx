import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { VoiceActorDirectoryPage } from "@/app/pages/voice-actor-directory";
import { actorSummary } from "@/app/test/fixtures";
import { readyFollowStore } from "@/app/test/follow";
import { renderWithLocale } from "@/app/test/render";

/** 検索欄はサーバーを呼ぶ。この画面で見たいのは一覧なので、呼び先だけ差し替える */
vi.mock("@/app/server-fns/actors", () => ({ searchActorsFn: vi.fn(async () => []) }));

const ALPHA = actorSummary({
  id: "va_alpha",
  slug: "alpha",
  canonicalName: "架空アルファ",
  nameEn: "Kakuu Alpha",
  workCount: 3,
  storeSlugs: ["dlsite", "audible"],
});
const BETA = actorSummary({
  id: "va_beta",
  slug: "beta",
  canonicalName: "架空ベータ",
  workCount: 1,
  storeSlugs: ["dlsite"],
});
const DELTA = actorSummary({
  id: "va_delta",
  slug: "delta",
  canonicalName: "架空デルタ",
  workCount: 4,
  storeSlugs: ["audible"],
});

const ACTORS = [ALPHA, BETA, DELTA];

function directory(label = "声優から探す") {
  return screen.getByRole("list", { name: label });
}

function rows(label?: string) {
  return within(directory(label)).getAllByRole("listitem");
}

function storeFilter() {
  return screen.getByRole("group", { name: "ストアで絞り込む" });
}

describe("VoiceActorDirectoryPage の並べ替え", () => {
  test("何も操作していない状態は作品数の多い順", () => {
    renderWithLocale(<VoiceActorDirectoryPage actors={ACTORS} />);

    expect(rows().map((row) => row.textContent)).toEqual([
      expect.stringContaining("架空デルタ"),
      expect.stringContaining("架空アルファ"),
      expect.stringContaining("架空ベータ"),
    ]);
  });

  test("名前順に変えると並びが変わり、人数は変わらない", async () => {
    const user = userEvent.setup();
    renderWithLocale(<VoiceActorDirectoryPage actors={ACTORS} />);

    await user.click(screen.getByRole("combobox", { name: "並び替え: 作品数の多い順" }));
    await user.click(screen.getByRole("option", { name: "名前順" }));

    expect(rows()[0]).toHaveTextContent("架空アルファ");
    expect(screen.getByText("3 人")).toBeInTheDocument();
  });

  test("作品数の多い順へ戻せる", async () => {
    const user = userEvent.setup();
    renderWithLocale(<VoiceActorDirectoryPage actors={ACTORS} />);

    await user.click(screen.getByRole("combobox", { name: "並び替え: 作品数の多い順" }));
    await user.click(screen.getByRole("option", { name: "名前順" }));
    await user.click(screen.getByRole("combobox", { name: "並び替え: 名前順" }));
    await user.click(screen.getByRole("option", { name: "作品数の多い順" }));

    expect(rows()[0]).toHaveTextContent("架空デルタ");
  });
});

describe("VoiceActorDirectoryPage のストア絞り込み", () => {
  test("絞ると、そのストアに作品がある声優だけが残る", async () => {
    const user = userEvent.setup();
    renderWithLocale(<VoiceActorDirectoryPage actors={ACTORS} />);
    expect(screen.getByText("3 人")).toBeInTheDocument();

    // ベータは DLsite にしか作品が無いので Audible では消える
    await user.click(within(storeFilter()).getByRole("button", { name: "Audible" }));

    expect(rows().map((row) => row.textContent)).toEqual([
      expect.stringContaining("架空デルタ"),
      expect.stringContaining("架空アルファ"),
    ]);
    expect(screen.getByText("2 人")).toBeInTheDocument();
  });

  test("すべてに戻すと全員が出る", async () => {
    const user = userEvent.setup();
    renderWithLocale(<VoiceActorDirectoryPage actors={ACTORS} />);

    await user.click(within(storeFilter()).getByRole("button", { name: "Audible" }));
    await user.click(within(storeFilter()).getByRole("button", { name: "すべて" }));

    expect(rows()).toHaveLength(3);
    expect(screen.getByText("3 人")).toBeInTheDocument();
  });

  test("絞り込んだ結果が 0 人でも画面は空にならない", async () => {
    const user = userEvent.setup();
    renderWithLocale(<VoiceActorDirectoryPage actors={ACTORS} />);

    await user.click(within(storeFilter()).getByRole("button", { name: "ポケドラ" }));

    expect(screen.getByText("ポケドラ に作品がある声優はいません")).toBeInTheDocument();
    expect(screen.getByText("0 人")).toBeInTheDocument();
  });

  test("押されているストアだけが aria-pressed を持つ", async () => {
    const user = userEvent.setup();
    renderWithLocale(<VoiceActorDirectoryPage actors={ACTORS} />);

    await user.click(within(storeFilter()).getByRole("button", { name: "Audible" }));

    const pressed = within(storeFilter())
      .getAllByRole("button")
      .filter((button) => button.getAttribute("aria-pressed") === "true");
    expect(pressed.map((button) => button.textContent)).toEqual(["Audible"]);
  });
});

describe("VoiceActorDirectoryPage の表示", () => {
  test("声優が 1 人も居なければ一覧そのものを出さない", () => {
    renderWithLocale(<VoiceActorDirectoryPage actors={[]} />);

    expect(screen.getByText("声優が見つかりません")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "声優から探す" })).not.toBeInTheDocument();
  });

  test("行は声優ページへ結び、作品数を添える", () => {
    renderWithLocale(<VoiceActorDirectoryPage actors={[ALPHA]} />);

    const link = within(rows()[0] as HTMLElement).getByRole("link");
    expect(link).toHaveAttribute("href", "/voice-actors/alpha");
    expect(link).toHaveTextContent("3 作品");
  });

  /** ローマ字を持たない声優は英語表示でも名前が消えない */
  test("英語表示ではローマ字を持つ声優はローマ字、持たない声優は漢字表記で出る", () => {
    renderWithLocale(<VoiceActorDirectoryPage actors={[ALPHA, BETA]} />, "en");

    const list = directory("Voice actors");
    expect(within(list).getByRole("link", { name: /Kakuu Alpha/ })).toBeInTheDocument();
    expect(within(list).getByRole("link", { name: /架空ベータ/ })).toBeInTheDocument();
  });
});

describe("VoiceActorDirectoryPage のフォロー", () => {
  test("一覧からフォローすると、その行のボタンがフォロー中になる", async () => {
    const user = userEvent.setup();
    await readyFollowStore();
    renderWithLocale(<VoiceActorDirectoryPage actors={[BETA]} />);

    const row = within(rows()[0] as HTMLElement);
    await user.click(row.getByRole("button", { name: "フォロー" }));

    expect(row.getByRole("button", { name: "フォロー中" })).toBeInTheDocument();
  });
});
