import { screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { CrawlerHealthPage } from "@/app/pages/admin/crawler-health";
import { crawlerHealth, crawlerHealthEntry, crawlRunSummary } from "@/app/test/fixtures";
import { renderWithLocale } from "@/app/test/render";

function table() {
  return screen.getByRole("table");
}

describe("CrawlerHealthPage の認可", () => {
  test("トークンが通っていなければ表を出さず、開き直し方を出す", () => {
    renderWithLocale(<CrawlerHealthPage authorized={false} configured />);

    expect(
      screen.getByRole("heading", { level: 1, name: "管理者トークンが必要です" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  test("サーバーに ADMIN_TOKEN が無いときは、その設定方法を出す", () => {
    renderWithLocale(<CrawlerHealthPage authorized={false} configured={false} />);

    expect(screen.getByText(/wrangler secret put ADMIN_TOKEN/)).toBeInTheDocument();
  });
});

describe("CrawlerHealthPage の表", () => {
  test("声優名を声優ページへ結び、ストアと取得件数を並べる", () => {
    renderWithLocale(<CrawlerHealthPage authorized health={crawlerHealth()} />);

    expect(within(table()).getByRole("link", { name: "架空アルファ" })).toHaveAttribute(
      "href",
      "/voice-actors/alpha",
    );
    expect(within(table()).getByText("DLsite")).toBeInTheDocument();
  });

  /** エラーにならず件数だけ減る壊れ方は、成否では気づけない。前回比の列で見せる */
  test("前回の成功と比べた増減を符号つきで出す", () => {
    const health = crawlerHealth({
      entries: [
        crawlerHealthEntry({
          latest: crawlRunSummary({ workCount: 0 }),
          previousOk: crawlRunSummary({ workCount: 12 }),
          warning: true,
          warningReason: "前回 12 件だったが 0 件になった",
        }),
      ],
    });
    renderWithLocale(<CrawlerHealthPage authorized health={health} />);

    expect(within(table()).getByText("-12")).toBeInTheDocument();
    expect(within(table()).getByText("前回 12 件だったが 0 件になった")).toBeInTheDocument();
    expect(within(table()).getByText("要確認")).toBeInTheDocument();
  });

  test("比較できる前回が無ければ増減は — にする", () => {
    renderWithLocale(<CrawlerHealthPage authorized health={crawlerHealth()} />);

    expect(within(table()).getAllByText("—").length).toBeGreaterThan(0);
  });

  /**
   * 網羅の分母はストアが出す総件数。読めなかった run を「完全」と取り違えないよう
   * 数字ではなく — を出す
   */
  test("総件数が読めた run は 取得/総件数 を出す", () => {
    const health = crawlerHealth({
      entries: [
        crawlerHealthEntry({
          latest: crawlRunSummary({ workCount: 30, totalCount: 48, coverageComplete: false }),
        }),
      ],
    });
    renderWithLocale(<CrawlerHealthPage authorized health={health} />);

    expect(within(table()).getByText("30/48")).toBeInTheDocument();
  });

  test("失敗した run はエラー本文まで出す", () => {
    const health = crawlerHealth({
      entries: [
        crawlerHealthEntry({
          latest: crawlRunSummary({ status: "error", error: "架空の失敗記録" }),
        }),
      ],
    });
    renderWithLocale(<CrawlerHealthPage authorized health={health} />);

    expect(within(table()).getByText("失敗")).toBeInTheDocument();
    expect(within(table()).getByText("架空の失敗記録")).toBeInTheDocument();
  });

  test("記録が 1 件も無ければ表ごと出さない", () => {
    renderWithLocale(<CrawlerHealthPage authorized health={crawlerHealth({ entries: [] })} />);

    expect(screen.getByText("まだクロールの記録がない。")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  test("もう 1 つの管理画面への導線を置く", () => {
    renderWithLocale(<CrawlerHealthPage authorized health={crawlerHealth()} />);

    expect(screen.getByRole("link", { name: "未解決クレジットへ" })).toHaveAttribute(
      "href",
      "/admin/unmatched-credits",
    );
  });
});
