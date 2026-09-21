import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { type ActorStoreWorks, VoiceActorPage } from "@/app/pages/voice-actor";
import {
  actorAnimeAppearance,
  actorDetail,
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
 * ストアごとの作品。出演形態の絞り込みを見るため、人数の違う 3 件をストアに分けて置く。
 * ポケドラは 1 件も無い (空のストアもセクションを出す)
 */
const WORKS: ActorStoreWorks[] = [
  {
    storeSlug: "dlsite",
    items: [
      workWithListings({
        work: workSummary({ id: "dlsite:RJ1", title: "架空のASMR作品" }),
        castSize: 1,
      }),
      workWithListings({
        work: workSummary({ id: "dlsite:RJ2", title: "架空の少人数作品" }),
        castSize: 3,
      }),
    ],
  },
  {
    storeSlug: "audible",
    items: [
      workWithListings({
        work: workSummary({ id: "audible:B01", title: "架空の大人数作品" }),
        castSize: 6,
      }),
    ],
  },
  { storeSlug: "pokedora", items: [] },
];

function render(over: Partial<Parameters<typeof VoiceActorPage>[0]> = {}, locale?: "ja" | "en") {
  return renderWithLocale(
    <VoiceActorPage
      actor={ACTOR}
      works={WORKS}
      anime={[]}
      appearance="all"
      onAppearanceChange={() => {}}
      {...over}
    />,
    locale,
  );
}

describe("VoiceActorPage の見出し", () => {
  test("h1 は声優名で、副題は読み仮名だけ", () => {
    render();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("架空アルファの音声作品");
    expect(screen.getByText("かくうあるふぁ")).toBeInTheDocument();
  });

  test("英語表示ではローマ字の名前で出す", () => {
    render({}, "en");

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Audio works by Kakuu Alpha",
    );
  });
});

describe("VoiceActorPage のストアごとのセクション", () => {
  test("作品があるストアもないストアも見出しを出す", () => {
    render();

    for (const store of ["DLsite", "Audible", "ポケドラ"]) {
      expect(screen.getByRole("heading", { level: 2, name: store })).toBeInTheDocument();
    }
  });

  test("作品が無いストアはそのストア名を入れた空表示を出す", () => {
    render();

    expect(screen.getByText("ポケドラ で見つかった作品はありません")).toBeInTheDocument();
  });

  test("作品があるストアは作品を並べる", () => {
    render();

    expect(screen.getByRole("link", { name: "架空のASMR作品" })).toBeInTheDocument();
  });
});

describe("VoiceActorPage の出演形態", () => {
  test("作品ごとに出演形態を出す", () => {
    render();

    expect(screen.getByText("単独")).toBeInTheDocument();
    expect(screen.getByText("少人数")).toBeInTheDocument();
    expect(screen.getByText("大人数")).toBeInTheDocument();
  });

  /** クレジットが 1 件も取れていない作品を「単独」と読ませない */
  test("クレジットが 0 件の作品は不明として出す", () => {
    render({
      works: [
        {
          storeSlug: "dlsite",
          items: [
            workWithListings({ work: workSummary({ title: "架空の不明作品" }), castSize: 0 }),
          ],
        },
      ],
    });

    expect(screen.getByText("出演形態不明")).toBeInTheDocument();
  });

  test("URL から来た区分で絞った状態を描く", () => {
    render({ appearance: "solo" });

    expect(screen.getByRole("link", { name: "架空のASMR作品" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "架空の少人数作品" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "架空の大人数作品" })).not.toBeInTheDocument();
  });

  test("絞り込んで 0 件になったストアは、絞り込みで消えたことが分かる空表示を出す", () => {
    render({ appearance: "solo" });

    expect(screen.getByText("Audible にこの出演形態の作品はありません")).toBeInTheDocument();
  });

  /** 元から 0 件のストアで「この出演形態の作品はありません」と言うと、他の形態ならあると読める */
  test("元から作品が無いストアは、絞り込み中でも作品が無いことを言う", () => {
    render({ appearance: "solo" });

    expect(screen.getByText("ポケドラ で見つかった作品はありません")).toBeInTheDocument();
  });

  /** 選択は URL に置くので、ページは変更を伝えるだけで自分では絞りを持たない */
  test("選ぶと選ばれた区分を呼び出し側へ渡す", async () => {
    const user = userEvent.setup();
    const onAppearanceChange = vi.fn();
    render({ onAppearanceChange });

    await user.click(screen.getByRole("combobox", { name: "出演形態: すべて" }));
    await user.click(screen.getByRole("option", { name: "大人数" }));

    expect(onAppearanceChange).toHaveBeenCalledWith("large");
  });

  test("判定しない区分は選択肢に出さない", async () => {
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

  test("絞り込み中は今の区分を読み上げ名に出す", () => {
    render({ appearance: "small" });

    expect(screen.getByRole("combobox", { name: "出演形態: 少人数" })).toBeInTheDocument();
  });
});

describe("VoiceActorPage の出演アニメ", () => {
  test("1 件も無ければ節ごと出さない", () => {
    render();

    expect(screen.queryByRole("heading", { level: 2, name: "出演アニメ" })).not.toBeInTheDocument();
  });

  test("役名・役種・シーズンを添えてアニメのページへ結ぶ", () => {
    render({ anime: [actorAnimeAppearance({ slug: "kakuu-no-anime" })] });

    expect(screen.getByRole("heading", { level: 2, name: "出演アニメ" })).toBeInTheDocument();
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
