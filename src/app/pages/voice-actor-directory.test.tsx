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

/**
 * 上限 (100 人) を越える顔ぶれ。
 *
 * 作品数を受け取った順と逆に振る。日本語表示の名前順は受け取った順そのままなので
 * (`lib/actor-directory` の `sortActors`)、並べ替えを変えると顔ぶれが入れ替わり、
 * 切る前に全員を並べ替えているかが見える
 */
const MANY = Array.from({ length: 120 }, (_, i) =>
  actorSummary({
    id: `va_many_${i}`,
    slug: `many-${i}`,
    canonicalName: `架空その${i}`,
    workCount: i + 1,
    storeSlugs: i % 2 === 0 ? ["dlsite"] : ["audible"],
  }),
);

function directory(label = "声優から探す") {
  return screen.getByRole("list", { name: label });
}

function rows(label?: string) {
  return within(directory(label)).getAllByRole("listitem");
}

function storeFilter(label = "ストアで絞り込む") {
  return screen.getByRole("group", { name: label });
}

function genderFilter(label = "性別で絞り込む") {
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

    expect(screen.getByText("この条件に当てはまる声優はいません")).toBeInTheDocument();
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

describe("VoiceActorDirectoryPage の性別の絞り込み", () => {
  /**
   * どの声優がどの性別かは画面に出さないので、絞り込んだ結果の顔ぶれでしか確かめられない。
   * 誰がどこに入るかの規則そのものは `lib/actor-directory` が持つ
   */
  // 選択肢の文言 (女性 / 男性 / その他 / 不明) を名前に含めない。含めると下の「書かない」テストが素通りする
  const FEMALE = actorSummary({
    id: "va_f",
    slug: "f",
    canonicalName: "架空アヤ",
    gender: "female",
  });
  const MALE = actorSummary({ id: "va_m", slug: "m", canonicalName: "架空イオ", gender: "male" });
  const UNKNOWN = actorSummary({ id: "va_u", slug: "u", canonicalName: "架空ウミ" });
  const MIXED = [FEMALE, MALE, UNKNOWN];

  const names = () =>
    rows().map((row) => within(row).getByRole("link").querySelector("span")?.textContent);

  test("開いた直後は全員が並ぶ", () => {
    renderWithLocale(<VoiceActorDirectoryPage actors={MIXED} />);

    expect(rows()).toHaveLength(3);
    expect(
      within(genderFilter()).getByRole("button", { name: "全員" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  test("女性を選ぶと女性だけになり、読み上げの人数も変わる", async () => {
    const user = userEvent.setup();
    renderWithLocale(<VoiceActorDirectoryPage actors={MIXED} />);

    await user.click(within(genderFilter()).getByRole("button", { name: "女性" }));

    expect(names()).toEqual(["架空アヤ"]);
    expect(screen.getByText("1 人")).toBeInTheDocument();
  });

  /** 増えたボタンが絞り込みの値に繋がっていること。誰がどの区分に入るかは `lib/actor-directory` が見る */
  test("不明を選ぶと不明の声優だけになる", async () => {
    const user = userEvent.setup();
    renderWithLocale(<VoiceActorDirectoryPage actors={MIXED} />);

    await user.click(within(genderFilter()).getByRole("button", { name: "不明" }));

    expect(names()).toEqual(["架空ウミ"]);
  });

  test("ストアの絞り込みと同時に効く", async () => {
    const user = userEvent.setup();
    renderWithLocale(<VoiceActorDirectoryPage actors={[ALPHA, BETA, DELTA, FEMALE]} />);

    await user.click(within(storeFilter()).getByRole("button", { name: "DLsite" }));
    await user.click(within(genderFilter()).getByRole("button", { name: "男性" }));

    expect(screen.getByText("この条件に当てはまる声優はいません")).toBeInTheDocument();
    expect(screen.getByText("0 人")).toBeInTheDocument();
  });

  test("選んだものだけが aria-pressed を持つ", async () => {
    const user = userEvent.setup();
    renderWithLocale(<VoiceActorDirectoryPage actors={MIXED} />);

    await user.click(within(genderFilter()).getByRole("button", { name: "男性" }));

    const pressed = within(genderFilter())
      .getAllByRole("button")
      .filter((button) => button.getAttribute("aria-pressed") === "true");
    expect(pressed.map((button) => button.textContent)).toEqual(["男性"]);
  });

  /** 出どころが利用者の編集できる外部 DB なので、誤りを人物の属性として掲示しない */
  test("誰がどの性別かは一覧に書かない", () => {
    renderWithLocale(<VoiceActorDirectoryPage actors={MIXED} />);

    for (const row of rows()) {
      expect(row.textContent).not.toMatch(/女性|男性|その他|不明/);
    }
  });

  test("性別で絞ると押せる頭文字もその顔ぶれから決まる", async () => {
    const user = userEvent.setup();
    const kaji = actorSummary({
      id: "va_kaji",
      slug: "kaji",
      canonicalName: "架空梶",
      nameEn: "Yuki Kaji",
      gender: "male",
    });
    const ueda = actorSummary({
      id: "va_ueda2",
      slug: "ueda2",
      canonicalName: "架空上田",
      nameEn: "Reina Ueda",
      gender: "female",
    });
    renderWithLocale(<VoiceActorDirectoryPage actors={[ueda, kaji]} />, "en");

    await user.click(
      within(genderFilter("Filter by gender")).getByRole("button", { name: "Women" }),
    );

    expect(buttonLabels(initialFilter())).toEqual(["All", "U"]);
  });

  test("英語表示では選択肢が英語で出る", () => {
    renderWithLocale(<VoiceActorDirectoryPage actors={MIXED} />, "en");

    expect(buttonLabels(genderFilter("Filter by gender"))).toEqual([
      "Everyone",
      "Women",
      "Men",
      "Other",
      "Unknown",
    ]);
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

/**
 * 上限そのものを見る区画。1 件ずつが 100 行以上を描くので、既定の 5 秒では
 * 他のテストと並走したときに足りない
 */
describe("VoiceActorDirectoryPage の表示件数の上限", { timeout: 20_000 }, () => {
  test("上限までしか並ばず、読み上げが当てはまる人数と並んでいる人数の両方を出す", () => {
    renderWithLocale(<VoiceActorDirectoryPage actors={MANY} />);

    expect(rows()).toHaveLength(100);
    expect(rows()[0]).toHaveTextContent("架空その119");
    expect(rows().at(-1)).toHaveTextContent("架空その20");
    expect(screen.getByText("120 人中 100 人")).toBeInTheDocument();
  });

  test("すべて表示を押すと残りが出て、ボタンが消える", async () => {
    const user = userEvent.setup();
    renderWithLocale(<VoiceActorDirectoryPage actors={MANY} />);

    await user.click(screen.getByRole("button", { name: "すべて表示" }));

    expect(rows()).toHaveLength(120);
    expect(screen.getByText("120 人")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "すべて表示" })).not.toBeInTheDocument();
  });

  /** 押すとボタン自身が消えるので、focus の行き先を作らないと文書の先頭へ落ちる */
  test("すべて表示を押すと、最初に現れた行へ focus が移る", async () => {
    const user = userEvent.setup();
    renderWithLocale(<VoiceActorDirectoryPage actors={MANY} />);

    await user.click(screen.getByRole("button", { name: "すべて表示" }));

    // 作品数の多い順で 101 人目。押す前は並んでいなかった行。
    // 読み上げ名ではなく href で見る。focus が body に落ちていても読み上げ名は一致してしまう
    expect(document.activeElement).toHaveAttribute("href", "/voice-actors/many-19");
  });

  test("上限に収まっていればボタンを出さない", () => {
    renderWithLocale(<VoiceActorDirectoryPage actors={ACTORS} />);

    expect(screen.queryByRole("button", { name: "すべて表示" })).not.toBeInTheDocument();
    expect(screen.getByText("3 人")).toBeInTheDocument();
  });

  /** 先に切ると、作品数の上位 100 人の中だけを並べ替えることになる */
  test("並べ替えは全員に効いてから切られる", async () => {
    const user = userEvent.setup();
    renderWithLocale(<VoiceActorDirectoryPage actors={MANY} />);

    await user.click(screen.getByRole("combobox", { name: "並び替え: 作品数の多い順" }));
    await user.click(screen.getByRole("option", { name: "名前順" }));

    // 「架空その0」は作品数が最も少ないので、作品数順の上位 100 人には居ない
    expect(rows()[0]).toHaveTextContent("架空その0");
    expect(rows()).toHaveLength(100);
  });

  /** ストアで絞ると全員が 60 人になり、上限に収まるのでボタンが消える */
  test("絞り込みも全員に効いてから切られる", async () => {
    const user = userEvent.setup();
    renderWithLocale(<VoiceActorDirectoryPage actors={MANY} />);

    await user.click(within(storeFilter()).getByRole("button", { name: "Audible" }));

    expect(rows()).toHaveLength(60);
    expect(screen.getByText("60 人")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "すべて表示" })).not.toBeInTheDocument();
  });

  test("一度すべて表示にすると、絞り込みを変えても全員のまま", async () => {
    const user = userEvent.setup();
    renderWithLocale(<VoiceActorDirectoryPage actors={MANY} />);

    await user.click(screen.getByRole("button", { name: "すべて表示" }));
    await user.click(within(storeFilter()).getByRole("button", { name: "Audible" }));
    await user.click(within(storeFilter()).getByRole("button", { name: "すべて" }));

    expect(rows()).toHaveLength(120);
    expect(screen.queryByRole("button", { name: "すべて表示" })).not.toBeInTheDocument();
  });

  test("英語表示でもボタンと読み上げが英語で出る", () => {
    renderWithLocale(<VoiceActorDirectoryPage actors={MANY} />, "en");

    expect(screen.getByText("100 of 120 voice actors")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show all" })).toBeInTheDocument();
  });
});
