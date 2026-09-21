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

/**
 * 英語表示の並びと頭文字を見るための顔ぶれ。`nameEn` は AniList の fullName と同じく名が先。
 * 「架空ベータ」はローマ字を持たない
 */
const UEDA = actorSummary({
  id: "va_ueda",
  slug: "ueda",
  canonicalName: "架空上田",
  nameEn: "Reina Ueda",
  workCount: 1,
  storeSlugs: ["dlsite"],
});
const HIKASA = actorSummary({
  id: "va_hikasa",
  slug: "hikasa",
  canonicalName: "架空日笠",
  nameEn: "Youko Hikasa",
  workCount: 2,
  storeSlugs: ["audible"],
});
const EN_ACTORS = [UEDA, HIKASA, BETA];

function directory(label = "声優から探す") {
  return screen.getByRole("list", { name: label });
}

function rows(label?: string) {
  return within(directory(label)).getAllByRole("listitem");
}

function storeFilter(label = "ストアで絞り込む") {
  return screen.getByRole("group", { name: label });
}

function initialFilter() {
  return screen.getByRole("group", { name: "Filter by initial" });
}

function buttonLabels(group: HTMLElement) {
  return within(group)
    .getAllByRole("button")
    .map((button) => button.textContent);
}

/** 英語表示で名前順に切り替える。頭文字と並びはどちらも英語表示でしか変わらない */
async function sortByNameInEnglish(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("combobox", { name: "Sort by: Most works" }));
  await user.click(screen.getByRole("option", { name: "Name" }));
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

  /** 音声作品がまだ 1 件も無い声優も一覧に出す。その人をフォローする入口がここにしか無い */
  test("作品が 1 件も無い声優も行に出て、末尾に来る", async () => {
    const user = userEvent.setup();
    await readyFollowStore();
    const empty = actorSummary({
      id: "va_empty",
      slug: "empty",
      canonicalName: "架空エプシロン",
      workCount: 0,
      storeSlugs: [],
    });
    renderWithLocale(<VoiceActorDirectoryPage actors={[empty, ...ACTORS]} />);

    const last = within(rows().at(-1) as HTMLElement);
    expect(last.getByRole("link")).toHaveAttribute("href", "/voice-actors/empty");
    expect(last.getByRole("link")).toHaveTextContent("0 作品");

    await user.click(last.getByRole("button", { name: "フォロー" }));
    expect(last.getByRole("button", { name: "フォロー中" })).toBeInTheDocument();
  });

  /** ローマ字を持たない声優は英語表示でも名前が消えない */
  test("英語表示ではローマ字を持つ声優はローマ字、持たない声優は漢字表記で出る", () => {
    renderWithLocale(<VoiceActorDirectoryPage actors={[ALPHA, BETA]} />, "en");

    const list = directory("Voice actors");
    expect(within(list).getByRole("link", { name: /Kakuu Alpha/ })).toBeInTheDocument();
    expect(within(list).getByRole("link", { name: /架空ベータ/ })).toBeInTheDocument();
  });
});

describe("VoiceActorDirectoryPage の英語表示", () => {
  test("名前順にするとローマ字の姓のアルファベット順になり、ローマ字の無い声優も残る", async () => {
    const user = userEvent.setup();
    renderWithLocale(<VoiceActorDirectoryPage actors={EN_ACTORS} />, "en");

    await sortByNameInEnglish(user);

    expect(rows("Voice actors").map((row) => row.textContent)).toEqual([
      expect.stringContaining("Youko Hikasa"),
      expect.stringContaining("Reina Ueda"),
      expect.stringContaining("架空ベータ"),
    ]);
  });

  test("作品数の多い順に戻すと作品数順になる", async () => {
    const user = userEvent.setup();
    renderWithLocale(<VoiceActorDirectoryPage actors={EN_ACTORS} />, "en");

    await sortByNameInEnglish(user);
    await user.click(screen.getByRole("combobox", { name: "Sort by: Name" }));
    await user.click(screen.getByRole("option", { name: "Most works" }));

    expect(rows("Voice actors")[0]).toHaveTextContent("Youko Hikasa");
  });

  /** 声優が居ない文字を押せると、押した先が必ず空になる */
  test("頭文字に出るのは、その文字で始まる声優が居る文字だけ", () => {
    renderWithLocale(<VoiceActorDirectoryPage actors={EN_ACTORS} />, "en");

    expect(buttonLabels(initialFilter())).toEqual(["All", "H", "U"]);
  });

  test("頭文字を押すとその文字の声優だけになり、すべてで戻る", async () => {
    const user = userEvent.setup();
    renderWithLocale(<VoiceActorDirectoryPage actors={EN_ACTORS} />, "en");

    await user.click(within(initialFilter()).getByRole("button", { name: "U" }));

    expect(rows("Voice actors").map((row) => row.textContent)).toEqual([
      expect.stringContaining("Reina Ueda"),
    ]);
    expect(screen.getByText("1 voice actor")).toBeInTheDocument();

    await user.click(within(initialFilter()).getByRole("button", { name: "All" }));

    expect(rows("Voice actors")).toHaveLength(3);
  });

  test("頭文字とストアの絞り込みは同時に効く", async () => {
    const user = userEvent.setup();
    renderWithLocale(<VoiceActorDirectoryPage actors={EN_ACTORS} />, "en");

    await user.click(
      within(storeFilter("Filter by store")).getByRole("button", { name: "DLsite" }),
    );
    await user.click(within(initialFilter()).getByRole("button", { name: "U" }));

    expect(rows("Voice actors").map((row) => row.textContent)).toEqual([
      expect.stringContaining("Reina Ueda"),
    ]);
  });

  /** 押せる文字はストアで絞った後の顔ぶれから作るので、選んでいた文字が消えることがある */
  test("ストアを変えて選んでいた頭文字が消えたら、頭文字の絞り込みが解ける", async () => {
    const user = userEvent.setup();
    renderWithLocale(<VoiceActorDirectoryPage actors={EN_ACTORS} />, "en");

    await user.click(within(initialFilter()).getByRole("button", { name: "U" }));
    await user.click(
      within(storeFilter("Filter by store")).getByRole("button", { name: "Audible" }),
    );

    expect(buttonLabels(initialFilter())).toEqual(["All", "H"]);
    expect(rows("Voice actors").map((row) => row.textContent)).toEqual([
      expect.stringContaining("Youko Hikasa"),
    ]);
  });

  /** 解けた絞り込みが戻ると、押していない文字で絞られた一覧が出る */
  test("消えて解けた頭文字は、ストアをすべてに戻しても掛かり直さない", async () => {
    const user = userEvent.setup();
    renderWithLocale(<VoiceActorDirectoryPage actors={EN_ACTORS} />, "en");

    await user.click(within(initialFilter()).getByRole("button", { name: "U" }));
    await user.click(
      within(storeFilter("Filter by store")).getByRole("button", { name: "Audible" }),
    );
    await user.click(within(storeFilter("Filter by store")).getByRole("button", { name: "All" }));

    expect(rows("Voice actors")).toHaveLength(3);
    const pressed = within(initialFilter())
      .getAllByRole("button")
      .filter((button) => button.getAttribute("aria-pressed") === "true");
    expect(pressed.map((button) => button.textContent)).toEqual(["All"]);
  });

  /** ストアを変えても、その文字の声優が残っていれば頭文字の絞り込みは効いたまま */
  test("ストアを変えても選んでいた頭文字が残っていれば絞り込みは続く", async () => {
    const user = userEvent.setup();
    renderWithLocale(<VoiceActorDirectoryPage actors={EN_ACTORS} />, "en");

    await user.click(within(initialFilter()).getByRole("button", { name: "U" }));
    await user.click(
      within(storeFilter("Filter by store")).getByRole("button", { name: "DLsite" }),
    );

    expect(rows("Voice actors").map((row) => row.textContent)).toEqual([
      expect.stringContaining("Reina Ueda"),
    ]);
  });

  test("日本語表示に頭文字の絞り込みは出ない", () => {
    renderWithLocale(<VoiceActorDirectoryPage actors={EN_ACTORS} />);

    expect(screen.queryByRole("group", { name: "頭文字で絞り込む" })).not.toBeInTheDocument();
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
