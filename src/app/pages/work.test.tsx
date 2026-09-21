import { screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { WorkPage } from "@/app/pages/work";
import { workCredit, workDetail, workListing, workSummary } from "@/app/test/fixtures";
import { renderWithLocale } from "@/app/test/render";

const DETAIL = workDetail({
  work: workSummary({
    title: "架空のASMR作品",
    makerName: "架空サークル",
    releaseDate: "2026-09-01",
    durationSeconds: 5160,
  }),
  listings: [
    workListing({
      affiliateUrl: "https://www.dlsite.com/home/dlaf/=/link/work/aid/example/id/RJ1.html",
    }),
  ],
  credits: [
    workCredit({ creditedName: "架空アルファ", role: "主演" }),
    // 名寄せできていない表記。声優ページへは結ばない
    workCredit({
      creditedName: "架空の未解決表記",
      confidence: "unmatched",
      voiceActorId: undefined,
      voiceActorSlug: undefined,
      voiceActorName: undefined,
    }),
  ],
});

describe("WorkPage の中身", () => {
  test("作品名を h1 に、再生時間を本文に出す", () => {
    renderWithLocale(<WorkPage detail={DETAIL} />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("架空のASMR作品");
    expect(screen.getByText("1時間26分")).toBeInTheDocument();
  });

  test("出演形態を出す", () => {
    renderWithLocale(<WorkPage detail={workDetail({ castSize: 6 })} />);

    expect(screen.getByText("大人数")).toBeInTheDocument();
  });

  test("発売日がある作品は発売日を出し、掲載を確認した月は出さない", () => {
    renderWithLocale(<WorkPage detail={DETAIL} />);

    expect(screen.getByText("2026年9月1日")).toBeInTheDocument();
    expect(screen.queryByText("掲載確認")).not.toBeInTheDocument();
  });

  /** ポケットドラマ CD は全作品が発売日を持たない。不明としか出ないと時点が読めない */
  test("発売日が不明な作品には掲載を確認した月を添える", () => {
    const detail = workDetail({
      work: workSummary({ releaseDate: undefined }),
      listings: [workListing({ firstSeenAt: "2026-03-01T00:00:00.000Z" })],
    });
    renderWithLocale(<WorkPage detail={detail} />);

    expect(screen.getByText("不明")).toBeInTheDocument();
    expect(screen.getByText("掲載確認")).toBeInTheDocument();
    expect(screen.getByText("2026年3月")).toBeInTheDocument();
  });

  test("再生時間が無い作品は行ごと出さない", () => {
    const detail = workDetail({ work: workSummary({ durationSeconds: undefined }) });
    renderWithLocale(<WorkPage detail={detail} />);

    expect(screen.queryByText("再生時間")).not.toBeInTheDocument();
  });

  test("ストアで確認する旨を、ストアの枚数によらず 1 度だけ添える", () => {
    const detail = workDetail({
      listings: [
        workListing({ storeSlug: "dlsite" }),
        workListing({ storeSlug: "audible", storeProductId: "B1" }),
      ],
    });
    renderWithLocale(<WorkPage detail={detail} />);

    expect(screen.getAllByText("価格と販売状況はストアでご確認ください。")).toHaveLength(1);
  });

  test("英語表示でもストアで確認する旨を出す", () => {
    renderWithLocale(<WorkPage detail={DETAIL} />, "en");

    expect(screen.getByText("Check the store for the price and availability.")).toBeInTheDocument();
  });
});

describe("WorkPage のクレジット", () => {
  test("名寄せ済みは声優ページへ結び、未解決はストア上の表記のまま出す", () => {
    renderWithLocale(<WorkPage detail={DETAIL} />);

    expect(screen.getByRole("link", { name: "架空アルファ" })).toHaveAttribute(
      "href",
      "/voice-actors/alpha",
    );
    expect(screen.getByText("架空の未解決表記")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "架空の未解決表記" })).not.toBeInTheDocument();
  });

  test("役が付いていれば名前に添える", () => {
    renderWithLocale(<WorkPage detail={DETAIL} />);

    expect(screen.getByText("主演")).toBeInTheDocument();
  });

  test("クレジットが 1 件も無ければ、無いと言う", () => {
    renderWithLocale(<WorkPage detail={workDetail({ credits: [] })} />);

    expect(screen.getByText("出演者の情報はありません。")).toBeInTheDocument();
  });

  /** 表記違いで同じ声優に解決された credit は 1 人に畳む */
  test("同じ声優に解決された表記違いは 1 回しか出さない", () => {
    const detail = workDetail({
      credits: [
        workCredit({ creditedName: "架空アルファ" }),
        workCredit({ creditedName: "架空 アルファ", sourceStoreSlug: "audible" }),
      ],
    });
    renderWithLocale(<WorkPage detail={detail} />);

    expect(screen.getAllByRole("link", { name: "架空アルファ" })).toHaveLength(1);
  });
});

describe("WorkPage のストアへの導線", () => {
  test("アフィリエイト URL があればそちらへ送り、rel に nofollow と sponsored を付ける", () => {
    renderWithLocale(<WorkPage detail={DETAIL} />);

    const link = screen.getByRole("link", { name: "DLsite で見る" });
    expect(link).toHaveAttribute("href", expect.stringContaining("dlaf"));
    expect(link).toHaveAttribute("rel", expect.stringContaining("nofollow"));
    expect(link).toHaveAttribute("rel", expect.stringContaining("sponsored"));
    expect(link).toHaveAttribute("target", "_blank");
  });

  test("ストアごとに 1 枚ずつ並べる", () => {
    const detail = workDetail({
      listings: [
        workListing({ storeSlug: "dlsite" }),
        workListing({ storeSlug: "audible", storeProductId: "B1" }),
      ],
    });
    renderWithLocale(<WorkPage detail={detail} />);

    const purchase = screen.getByRole("heading", { level: 2, name: "購入" }).parentElement;
    expect(
      within(purchase as HTMLElement).getByRole("link", { name: "DLsite で見る" }),
    ).toBeInTheDocument();
    expect(
      within(purchase as HTMLElement).getByRole("link", { name: "Audible で聴く" }),
    ).toBeInTheDocument();
  });
});
