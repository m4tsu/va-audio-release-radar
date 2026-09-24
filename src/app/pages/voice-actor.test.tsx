import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_WORK_FILTERS } from "@/app/lib/work-filters";
import { VoiceActorPage } from "@/app/pages/voice-actor";
import { useFollowStore } from "@/app/store/follow-store";
import { resetPushStoreForTest, usePushStore } from "@/app/store/push-store";
import {
  actorAnimeAppearance,
  actorDetail,
  workListing,
  workSummary,
  workWithListings,
} from "@/app/test/fixtures";
import { readyFollowStore } from "@/app/test/follow";
import { renderWithLocale } from "@/app/test/render";

const ACTOR = actorDetail({
  slug: "alpha",
  canonicalName: "架空アルファ",
  nameKana: "かくうあるふぁ",
  nameEn: "Kakuu Alpha",
});

/**
 * 発売日の新しい順に並んだ 1 本の一覧。3 つの軸 (ストア・区分・出演形態) を
 * 別々に確かめられるよう、どの 2 件も 3 つのうち 1 つだけが揃うようにしてある
 */
const WORKS = [
  workWithListings({
    work: workSummary({ id: "dlsite:RJ1", title: "架空のASMR作品", category: "asmr" }),
    listings: [workListing({ storeSlug: "dlsite", storeProductId: "RJ1" })],
    castSize: 1,
  }),
  workWithListings({
    work: workSummary({ id: "audible:B01", title: "架空の朗読作品", category: "audiobook" }),
    listings: [workListing({ storeSlug: "audible", storeProductId: "B01" })],
    castSize: 6,
  }),
  workWithListings({
    work: workSummary({
      id: "pokedora:P1",
      title: "架空のボイスドラマ作品",
      category: "audio_drama",
    }),
    listings: [workListing({ storeSlug: "pokedora", storeProductId: "P1" })],
    castSize: 3,
  }),
];

const STATS = { voiceActorId: ACTOR.id, workCount: WORKS.length, latestReleaseDate: "2026-09-18" };

function render(over: Partial<Parameters<typeof VoiceActorPage>[0]> = {}, locale?: "ja" | "en") {
  return renderWithLocale(
    <VoiceActorPage
      actor={ACTOR}
      works={WORKS}
      stats={STATS}
      anime={[]}
      coverage={[]}
      filters={DEFAULT_WORK_FILTERS}
      onFiltersChange={() => {}}
      vapidPublicKey={null}
      {...over}
    />,
    locale,
  );
}

/** 一覧に並んでいる作品名を、描かれている順のまま取る */
function shownTitles(): string[] {
  return screen
    .queryAllByRole("link")
    .map((link) => link.textContent ?? "")
    .filter((text) => text.startsWith("架空の"));
}

describe("VoiceActorPage の見出し", () => {
  test("h1 は声優名で、副題に読み仮名が出る", () => {
    render();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("架空アルファの音声作品");
    expect(screen.getByText("かくうあるふぁ")).toBeInTheDocument();
  });

  /**
   * 性別は `ActorDetail` に載っているが、出どころが利用者の編集できる外部 DB なので、
   * 誤りを人物の属性として掲示しない。絞り込みの軸としてだけ使う (`pages/voice-actor-directory`)
   */
  test("性別は画面に出さない", () => {
    render({ actor: actorDetail({ ...ACTOR, gender: "female" }) });

    expect(screen.queryByText(/女性|男性/)).not.toBeInTheDocument();
  });

  test("英語表示ではローマ字の名前で出す", () => {
    render({}, "en");

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Audio works by Kakuu Alpha",
    );
  });
});

/** フォローを押す前に「何件出していて、最後はいつ出たか」が読めること */
describe("VoiceActorPage の実績", () => {
  test("見出しの下に作品数と最新リリースの年月を出す", () => {
    render();

    expect(screen.getByText("3 作品 ／ 最新リリース 2026年9月")).toBeInTheDocument();
  });

  /** 一覧は上限で切るので、数えた結果は一覧の長さではなく声優の作品数 */
  test("一覧を上限で切っていても、作品数は切る前の数を出す", () => {
    render({ stats: { ...STATS, workCount: 42 } });

    expect(screen.getByText("42 作品 ／ 最新リリース 2026年9月")).toBeInTheDocument();
  });

  test("英語表示では年月も英語で出す", () => {
    render({}, "en");

    expect(screen.getByText("3 works / Latest release September 2026")).toBeInTheDocument();
  });
});

describe("VoiceActorPage の作品一覧", () => {
  /** ストアで節に割ると、どの節も数件ずつになって「この人は何を出しているか」が読めない */
  test("ストアごとの節を作らず、渡された順のまま 1 本に並べる", () => {
    render();

    for (const store of ["DLsite", "Audible", "ポケドラ"]) {
      expect(screen.queryByRole("heading", { level: 2, name: store })).not.toBeInTheDocument();
    }
    expect(shownTitles()).toEqual(["架空のASMR作品", "架空の朗読作品", "架空のボイスドラマ作品"]);
  });

  test("作品ごとに出演形態を出す", () => {
    render();

    expect(screen.getByText("単独")).toBeInTheDocument();
    expect(screen.getByText("少人数")).toBeInTheDocument();
    expect(screen.getByText("大人数")).toBeInTheDocument();
  });

  /** クレジットが 1 件も取れていない作品を「単独」と読ませない */
  test("クレジットが 0 件の作品は不明として出す", () => {
    render({ works: [workWithListings({ castSize: 0 })] });

    expect(screen.getByText("出演形態不明")).toBeInTheDocument();
  });
});

/**
 * 一覧は上限で切る。切った先の作品は絞り込みにも当たらないので、
 * 「このストアには無い」と読める 0 件が出うる。切ったことを画面が言う
 */
describe("VoiceActorPage の打ち切り", () => {
  test("上限で切っているときは、新着順と注記する", () => {
    render({ stats: { ...STATS, workCount: 42 } });

    expect(screen.getByText("新着順")).toBeInTheDocument();
  });

  test("全件が並んでいるなら注記を出さない", () => {
    render();

    expect(screen.queryByText("新着順")).not.toBeInTheDocument();
  });

  /** 分母を声優の作品数にすると、「42 作品中 1 作品」が「このストアに 1 作品」と読める */
  test("絞り込みの件数の分母は、並べた件数にする", () => {
    render({
      stats: { ...STATS, workCount: 42 },
      filters: { ...DEFAULT_WORK_FILTERS, store: "audible" },
    });

    expect(screen.getByText("3 作品中 1 作品")).toBeInTheDocument();
  });

  test("絞り込んでいなければ件数だけを出す", () => {
    render();

    expect(screen.getByText("3 作品", { selector: "p" })).toBeInTheDocument();
  });
});

describe("VoiceActorPage の絞り込み", () => {
  test("URL から来たストアで絞った状態を描く", () => {
    render({ filters: { ...DEFAULT_WORK_FILTERS, store: "audible" } });

    expect(shownTitles()).toEqual(["架空の朗読作品"]);
  });

  test("URL から来た区分で絞った状態を描く", () => {
    render({ filters: { ...DEFAULT_WORK_FILTERS, category: "audio_drama" } });

    expect(shownTitles()).toEqual(["架空のボイスドラマ作品"]);
  });

  test("URL から来た出演形態で絞った状態を描く", () => {
    render({ filters: { ...DEFAULT_WORK_FILTERS, appearance: "solo" } });

    expect(shownTitles()).toEqual(["架空のASMR作品"]);
  });

  test("3 つの軸は重ねて効く", () => {
    render({
      filters: { store: "dlsite", category: "asmr", appearance: "large" },
    });

    expect(shownTitles()).toEqual([]);
  });

  /** 軸が 3 つあるので、どの軸で 0 件になったかを 1 つ名指しすると嘘になる */
  test("0 件になったら、どの軸とも言わずに条件に合わないことを出す", () => {
    render({ filters: { ...DEFAULT_WORK_FILTERS, appearance: "solo", store: "audible" } });

    expect(screen.getByText("この条件に当てはまる作品はありません")).toBeInTheDocument();
  });

  /** 選択は URL に置くので、ページは変更を伝えるだけで自分では絞りを持たない */
  test("選ぶと 3 つの軸をまとめて呼び出し側へ渡す", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    render({ filters: { ...DEFAULT_WORK_FILTERS, appearance: "solo" }, onFiltersChange });

    await user.click(screen.getByRole("combobox", { name: "ストア: すべて" }));
    await user.click(screen.getByRole("option", { name: "Audible" }));

    expect(onFiltersChange).toHaveBeenCalledWith({
      store: "audible",
      category: "all",
      appearance: "solo",
    });
  });

  /** 3 つの欄が横に並ぶので、値だけでは押す前にどの軸か分からない */
  test("欄には軸の名前と今の値の両方を出す", () => {
    render({ filters: { store: "dlsite", category: "asmr", appearance: "small" } });

    expect(screen.getByRole("combobox", { name: "ストア: DLsite" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "区分: ASMR" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "出演形態: 少人数" })).toBeInTheDocument();
  });

  /** 選択肢を手元の作品から作ると、上限で切った先にしか無いストアを選べなくなる */
  test("ストアの選択肢はこの声優の作品の有無で変えない", async () => {
    const user = userEvent.setup();
    render({ works: WORKS.slice(0, 1) });

    await user.click(screen.getByRole("combobox", { name: "ストア: すべて" }));

    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "すべて",
      "DLsite",
      "Audible",
      "ポケドラ",
    ]);
  });

  test("判定しない出演形態は選択肢に出さない", async () => {
    const user = userEvent.setup();
    render();

    await user.click(screen.getByRole("combobox", { name: "出演形態: すべて" }));

    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "すべて",
      "単独",
      "少人数",
      "大人数",
    ]);
  });
});

/**
 * 音声作品がまだ 1 件も無い声優。ページは 200 で返り、フォローと出演アニメだけが残る
 * (`docs/decisions/0012-follow-actors-without-works.md`)
 */
describe("VoiceActorPage の作品が 1 件も無いとき", () => {
  const EMPTY = { works: [], stats: { voiceActorId: ACTOR.id, workCount: 0 } };

  test("まだ見つかっていないことを 1 つだけ出す", () => {
    render(EMPTY);

    expect(screen.getByText("音声作品はまだ見つかっていません")).toBeInTheDocument();
  });

  /** 「0 作品」は数えた結果ではなく、まだ見つかっていないという状態 */
  test("作品数も最新リリースも出さない", () => {
    render(EMPTY);

    expect(screen.queryByText(/^\d+ 作品/)).not.toBeInTheDocument();
    expect(screen.queryByText(/最新リリース/)).not.toBeInTheDocument();
  });

  /** 選んでも結果の変わらない絞り込みを出すと、押した人が壊れていると思う */
  test("絞り込みを出さない", () => {
    render(EMPTY);

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  /**
   * 0 件なのは「そのストアに無い」ではない
   * (`docs/decisions/0010-back-catalog-is-what-was-fetched.md`)。ストアで探す導線を残す
   */
  test("取り切れていないストアがあれば、そのストアの検索へのリンクを出す", () => {
    render({ ...EMPTY, coverage: [{ storeSlug: "audible", complete: false }] });

    expect(screen.getByText("音声作品はまだ見つかっていません")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Audible で全作品を見る" })).toHaveAttribute(
      "href",
      "https://www.audible.co.jp/search?searchNarrator=%E6%9E%B6%E7%A9%BA%E3%82%A2%E3%83%AB%E3%83%95%E3%82%A1",
    );
  });

  test("取り切れたストアしか無ければリンクを出さない", () => {
    render({ ...EMPTY, coverage: [{ storeSlug: "audible", complete: true }] });

    expect(screen.queryByRole("link", { name: /全作品を見る/ })).not.toBeInTheDocument();
  });

  test("フォローと出演アニメは出る", async () => {
    const user = userEvent.setup();
    await readyFollowStore();
    render({ ...EMPTY, anime: [actorAnimeAppearance({ slug: "kakuu-no-anime" })] });

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("架空アルファの音声作品");
    expect(screen.getByRole("link", { name: /架空のアニメ/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "フォロー" }));
    expect(screen.getByRole("button", { name: "フォロー中" })).toBeInTheDocument();
  });
});

describe("VoiceActorPage の網羅の注記", () => {
  /** 節が無くなっても、取り切れていないことは一覧の手前で読めなければならない */
  test("取り切れていないストアには注記とストアの検索へのリンクを出す", () => {
    render({ coverage: [{ storeSlug: "audible", complete: false }] });

    expect(screen.getByText("Audible の作品は一部だけを載せています。")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Audible で全作品を見る" });
    expect(link).toHaveAttribute(
      "href",
      "https://www.audible.co.jp/search?searchNarrator=%E6%9E%B6%E7%A9%BA%E3%82%A2%E3%83%AB%E3%83%95%E3%82%A1",
    );
    expect(link).toHaveAttribute("rel", "noopener nofollow");
  });

  /** 検索語は表示言語で変えない。相手は日本語のストアで、ローマ字表記では引けない */
  test("英語表示でも注記を出し、検索語は正規表記のまま", () => {
    render({ coverage: [{ storeSlug: "audible", complete: false }] }, "en");

    expect(
      screen.getByText("Only part of this actor's works on Audible are listed here."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See all works on Audible" })).toHaveAttribute(
      "href",
      "https://www.audible.co.jp/search?searchNarrator=%E6%9E%B6%E7%A9%BA%E3%82%A2%E3%83%AB%E3%83%95%E3%82%A1",
    );
  });

  test("取り切れたストアには何も出さない", () => {
    render({ coverage: [{ storeSlug: "dlsite", complete: true }] });

    expect(screen.queryByText(/一部だけを載せています/)).not.toBeInTheDocument();
  });

  /** 走行の記録が無いストアは `coverage` に入ってこない */
  test("走行の記録が無ければ何も出さない", () => {
    render();

    expect(screen.queryByText(/一部だけを載せています/)).not.toBeInTheDocument();
  });

  /** Audible は空白の有無で結果が変わる。クローラーが先に試す表記に合わせる */
  test("Audible のリンクは検証済みの空白入り別名で引く", () => {
    render({
      actor: actorDetail({
        canonicalName: "架空アルファ",
        aliases: [
          { voiceActorId: "va_alpha", name: "架空 アルファ", source: "manual", verified: true },
        ],
      }),
      coverage: [{ storeSlug: "audible", complete: false }],
    });

    expect(screen.getByRole("link", { name: "Audible で全作品を見る" })).toHaveAttribute(
      "href",
      "https://www.audible.co.jp/search?searchNarrator=%E6%9E%B6%E7%A9%BA%20%E3%82%A2%E3%83%AB%E3%83%95%E3%82%A1",
    );
  });

  /** 名前から声優ページを開く手段がストアに無い。押せないリンクは出さない */
  test("ポケドラは注記だけでリンクを出さない", () => {
    render({ coverage: [{ storeSlug: "pokedora", complete: false }] });

    expect(screen.getByText("ポケドラ の作品は一部だけを載せています。")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /全作品を見る/ })).not.toBeInTheDocument();
  });
});

describe("VoiceActorPage の出演アニメ", () => {
  test("1 件も無ければ節ごと出さない", () => {
    render();

    expect(
      screen.queryByRole("heading", { level: 2, name: "直近出演アニメ" }),
    ).not.toBeInTheDocument();
  });

  test("役名・役種・シーズンを添えてアニメのページへ結ぶ", () => {
    render({ anime: [actorAnimeAppearance({ slug: "kakuu-no-anime" })] });

    expect(screen.getByRole("heading", { level: 2, name: "直近出演アニメ" })).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /架空のアニメ/ });
    expect(link).toHaveAttribute("href", "/anime/kakuu-no-anime");
    expect(link).toHaveTextContent("架空キャラ");
    expect(link).toHaveTextContent("主演");
    expect(link).toHaveTextContent("2026 年秋");
  });
});

describe("VoiceActorPage のフォロー", () => {
  test("見出しの横のボタンでフォローできる", async () => {
    const user = userEvent.setup();
    await readyFollowStore();
    render();

    await user.click(screen.getByRole("button", { name: "フォロー" }));

    expect(screen.getByRole("button", { name: "フォロー中" })).toBeInTheDocument();
  });

  /** 読み込みが済むまで押せると、直後に届いた保存済みの状態で操作が消える */
  test("読み込みが済むまでは押せない", () => {
    render();

    expect(screen.getByRole("button", { name: "フォロー" })).toBeDisabled();
  });
});

describe("VoiceActorPage の訂正の申し出", () => {
  /** 別名義が結び付いていないことに気づいた人が、声優名を書き写さずに知らせられる */
  test("この声優を対象にした問い合わせへ送る", () => {
    render();

    expect(screen.getByRole("link", { name: "掲載内容の誤りを知らせる" })).toHaveAttribute(
      "href",
      "/contact?kind=correction&about=%2Fvoice-actors%2Falpha",
    );
  });
});

/** 作品一覧が長いと、その後ろの出演アニメが視界に入らない */
describe("VoiceActorPage の出演アニメへのページ内リンク", () => {
  test("作品と出演アニメの両方があれば、見出しの下から出演アニメの見出しへ飛べる", () => {
    render({ anime: [actorAnimeAppearance()] });

    const link = screen.getByRole("link", { name: "直近出演アニメへ" });
    const heading = screen.getByRole("heading", { level: 2, name: "直近出演アニメ" });
    expect(link).toHaveAttribute("href", `#${heading.id}`);
  });

  test("出演アニメが無ければリンクを出さない", () => {
    render();

    expect(screen.queryByRole("link", { name: "直近出演アニメへ" })).not.toBeInTheDocument();
  });

  /** 作品が無ければ出演アニメは案内のすぐ下にある */
  test("作品が無ければリンクを出さない", () => {
    render({
      works: [],
      stats: { voiceActorId: ACTOR.id, workCount: 0 },
      anime: [actorAnimeAppearance()],
    });

    expect(screen.queryByRole("link", { name: "直近出演アニメへ" })).not.toBeInTheDocument();
  });

  test("英語表示でも出る", () => {
    render({ anime: [actorAnimeAppearance()] }, "en");

    expect(screen.getByRole("link", { name: "Recent anime appearances" })).toBeInTheDocument();
  });
});

/**
 * 通知の設定はフォロー中ページにしか無い。声優ページからフォローした人が通知に気づけるよう、
 * このページで押した直後にだけ案内する。案内の中身の出し分けは push-follow-prompt.test.tsx が見る
 */
describe("VoiceActorPage のフォロー直後の通知の案内", () => {
  const KEY = "BExampleKey";
  const PROMPT = "フォローした声優の新作が出たら、このブラウザに通知できます。";

  afterEach(async () => {
    await resetPushStoreForTest();
  });

  test("未購読のブラウザでフォローを押すと、通知を受け取る操作が出る", async () => {
    const user = userEvent.setup();
    usePushStore.setState({ status: "unsubscribed" });
    await readyFollowStore();
    render({ vapidPublicKey: KEY });

    expect(screen.queryByText(PROMPT)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "フォロー" }));

    expect(screen.getByText(PROMPT)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新作の通知を受け取る" })).toBeInTheDocument();
  });

  test("開いた時点でフォロー済みなら、押していないので出さない", async () => {
    usePushStore.setState({ status: "unsubscribed" });
    await readyFollowStore();
    await useFollowStore.getState().follow({
      voiceActorId: ACTOR.id,
      slug: ACTOR.slug,
      canonicalName: ACTOR.canonicalName,
    });
    render({ vapidPublicKey: KEY });

    expect(screen.getByRole("button", { name: "フォロー中" })).toBeInTheDocument();
    expect(screen.queryByText(PROMPT)).not.toBeInTheDocument();
  });

  test("フォローを外すと案内も消える", async () => {
    const user = userEvent.setup();
    usePushStore.setState({ status: "unsubscribed" });
    await readyFollowStore();
    render({ vapidPublicKey: KEY });

    await user.click(screen.getByRole("button", { name: "フォロー" }));
    await user.click(screen.getByRole("button", { name: "フォロー中" }));

    expect(screen.queryByText(PROMPT)).not.toBeInTheDocument();
  });

  test("公開鍵が無い環境では出さない", async () => {
    const user = userEvent.setup();
    usePushStore.setState({ status: "unsubscribed" });
    await readyFollowStore();
    render();

    await user.click(screen.getByRole("button", { name: "フォロー" }));

    expect(screen.queryByText(PROMPT)).not.toBeInTheDocument();
  });
});
