import { screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { WorkCard } from "@/app/components/work-card";
import { workListing, workSummary, workWithListings } from "@/app/test/fixtures";
import { renderWithLocale } from "@/app/test/render";

const item = workWithListings();

/** 発売日を持たない作品 (ポケドラと Audible のポッドキャスト)。掲載を見つけたのは 2026-03 */
const listedOnly = workWithListings({
  work: workSummary({ releaseDate: undefined }),
  listings: [workListing({ firstSeenAt: "2026-03-01T00:00:00.000Z" })],
});

function actor(index: number) {
  return { id: `va_${index}`, slug: `actor-${index}`, name: `声優${index}` };
}

/** 声優ページへのリンクだけを拾う。作品名のリンクは行き先が違うので混ざらない */
function actorLinks() {
  return screen
    .getAllByRole("link")
    .filter((link) => link.getAttribute("href")?.startsWith("/voice-actors/"));
}

describe("WorkCard の出演形態", () => {
  test("クレジットの人数から決まる区分を出す", () => {
    renderWithLocale(<WorkCard item={workWithListings({ castSize: 3 })} />);

    expect(screen.getByText("少人数")).toBeInTheDocument();
  });

  /** クレジットが取れていないことを「単独」と読ませない */
  test("クレジットが 0 件なら不明として出す", () => {
    renderWithLocale(<WorkCard item={workWithListings({ castSize: 0 })} />);

    expect(screen.getByText("出演形態不明")).toBeInTheDocument();
  });
});

describe("WorkCard の出演声優", () => {
  test("渡された声優の名前を出し、その声優のページへ結ぶ", () => {
    renderWithLocale(<WorkCard item={item} actors={[actor(1), actor(2)]} />);

    expect(actorLinks().map((link) => link.textContent)).toEqual(["声優1", "声優2"]);
    expect(actorLinks()[0]).toHaveAttribute("href", "/voice-actors/actor-1");
  });

  test("actors を渡さなければ名前の行が出ない", () => {
    renderWithLocale(<WorkCard item={item} />);

    expect(actorLinks()).toHaveLength(0);
  });

  test("空の配列でも名前の行が出ない", () => {
    renderWithLocale(<WorkCard item={item} actors={[]} />);

    expect(actorLinks()).toHaveLength(0);
  });

  test("上限を渡すと先頭だけを出し、残りは人数で示す", () => {
    renderWithLocale(<WorkCard item={item} actors={[1, 2, 3, 4, 5].map(actor)} actorLimit={3} />);

    expect(actorLinks().map((link) => link.textContent)).toEqual(["声優1", "声優2", "声優3"]);
    expect(screen.getByText("他 2 名")).toBeInTheDocument();
  });

  test("上限に届かなければ人数を添えない", () => {
    renderWithLocale(<WorkCard item={item} actors={[actor(1), actor(2)]} actorLimit={3} />);

    expect(screen.queryByText(/他 \d+ 名/)).not.toBeInTheDocument();
  });

  /** 表記違いで同じ声優に解決された credit は、上限を数える前に 1 人に畳む */
  test("同じ声優が重複していても 1 回しか出さず、余りにも数えない", () => {
    const ueda = { id: "va_ueda", slug: "ueda-reina", name: "上田麗奈" };
    renderWithLocale(
      <WorkCard
        item={item}
        actors={[ueda, { ...ueda, name: "上田 麗奈" }, actor(1)]}
        actorLimit={2}
      />,
    );

    expect(actorLinks().map((link) => link.textContent)).toEqual(["上田麗奈", "声優1"]);
    expect(screen.queryByText(/他 \d+ 名/)).not.toBeInTheDocument();
  });

  test("英語表示ではローマ字があればローマ字を出す", () => {
    renderWithLocale(
      <WorkCard
        item={item}
        actors={[
          { id: "va_ueda", slug: "ueda-reina", name: "上田麗奈", nameEn: "Reina Ueda" },
          { id: "va_kana", slug: "hanazawa-kana", name: "花澤香菜" },
        ]}
      />,
      "en",
    );

    expect(actorLinks().map((link) => link.textContent)).toEqual(["Reina Ueda", "花澤香菜"]);
  });
});

describe("WorkCard の日付", () => {
  test("発売日がある作品は発売日を出し、掲載を確認した月は出さない", () => {
    const withRelease = workWithListings({ work: workSummary({ releaseDate: "2026-09-01" }) });
    renderWithLocale(<WorkCard item={withRelease} />);

    expect(screen.getByText("2026年9月1日")).toBeInTheDocument();
    expect(screen.queryByText("掲載確認")).not.toBeInTheDocument();
  });

  /** ポケットドラマ CD は全作品が発売日を持たない。行ごと落とすと時点が何も読めない */
  test("発売日が無い作品は掲載を確認した月を見出しつきで出す", () => {
    renderWithLocale(<WorkCard item={listedOnly} />);

    expect(screen.getByText("掲載確認")).toBeInTheDocument();
    expect(screen.getByText("2026年3月")).toBeInTheDocument();
  });

  test("英語表示でも掲載を確認した月を出す", () => {
    renderWithLocale(<WorkCard item={listedOnly} />, "en");

    expect(screen.getByText("Listed")).toBeInTheDocument();
    expect(screen.getByText("March 2026")).toBeInTheDocument();
  });
});

describe("WorkCard の新着の印", () => {
  test("発売日が新しい作品には NEW を出す", () => {
    const released = workWithListings({
      work: workSummary({ releaseDate: "2026-09-18" }),
      isNew: true,
    });
    renderWithLocale(<WorkCard item={released} />);

    expect(screen.getByText("NEW")).toBeInTheDocument();
    expect(screen.queryByText("掲載")).not.toBeInTheDocument();
  });

  /** 発売日が無い作品の「新しい」は発売ではなく掲載を見つけたこと。同じ語で並べない */
  test("発売日が無い作品には掲載の印を出す", () => {
    renderWithLocale(<WorkCard item={{ ...listedOnly, isNew: true }} />);

    expect(screen.getByText("掲載")).toBeInTheDocument();
    expect(screen.queryByText("NEW")).not.toBeInTheDocument();
  });

  test("英語表示では LISTED を出す", () => {
    renderWithLocale(<WorkCard item={{ ...listedOnly, isNew: true }} />, "en");

    expect(screen.getByText("LISTED")).toBeInTheDocument();
    expect(screen.queryByText("NEW")).not.toBeInTheDocument();
  });

  test("新着でなければどちらの印も出さない", () => {
    renderWithLocale(<WorkCard item={listedOnly} />);

    expect(screen.queryByText("掲載")).not.toBeInTheDocument();
    expect(screen.queryByText("NEW")).not.toBeInTheDocument();
  });
});
