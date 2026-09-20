import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
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

/** ベータは DLsite にしか作品が無い。空のストアもセクションを出す */
const WORKS: ActorStoreWorks[] = [
  {
    storeSlug: "dlsite",
    items: [workWithListings({ work: workSummary({ title: "架空のASMR作品" }) })],
  },
  { storeSlug: "audible", items: [] },
  { storeSlug: "pokedora", items: [] },
];

function render(over: Partial<Parameters<typeof VoiceActorPage>[0]> = {}, locale?: "ja" | "en") {
  return renderWithLocale(
    <VoiceActorPage actor={ACTOR} works={WORKS} anime={[]} {...over} />,
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

    expect(screen.getByText("Audible で見つかった作品はありません")).toBeInTheDocument();
    expect(screen.getByText("ポケドラ で見つかった作品はありません")).toBeInTheDocument();
  });

  test("作品があるストアは作品を並べる", () => {
    render();

    expect(screen.getByRole("link", { name: "架空のASMR作品" })).toBeInTheDocument();
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
