import { screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { AdminInquiriesPage } from "@/app/pages/admin/inquiries";
import { inquiry } from "@/app/test/fixtures";
import { renderWithLocale } from "@/app/test/render";

function table() {
  return screen.getByRole("table");
}

describe("AdminInquiriesPage の認可", () => {
  test("トークンが通っていなければ表を出さない", () => {
    renderWithLocale(<AdminInquiriesPage authorized={false} configured />);

    expect(
      screen.getByRole("heading", { level: 1, name: "管理者トークンが必要です" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  test("サーバーに ADMIN_TOKEN が無いときは、その設定方法を出す", () => {
    renderWithLocale(<AdminInquiriesPage authorized={false} configured={false} />);

    expect(screen.getByText(/wrangler secret put ADMIN_TOKEN/)).toBeInTheDocument();
  });
});

describe("AdminInquiriesPage の表", () => {
  test("受け取った日時・種別・本文・連絡先を出す", () => {
    renderWithLocale(
      <AdminInquiriesPage
        authorized
        page={1}
        hasNext={false}
        inquiries={[
          inquiry({
            kind: "bug",
            body: "声優ページが開けない",
            contact: "user@example.com",
            receivedAt: "2026-09-20T04:30:00.000Z",
          }),
        ]}
      />,
    );

    const row = within(table()).getAllByRole("row")[1];
    expect(row).toBeDefined();
    expect(within(row as HTMLElement).getByText("不具合")).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText("声優ページが開けない")).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText("user@example.com")).toBeInTheDocument();
    // 日本のストアを扱うので、表示は言語を問わず JST
    expect(within(row as HTMLElement).getByText(/13:30/)).toBeInTheDocument();
  });

  /** 渡された順をそのまま描いていることを確かめる。並べ替えは読み出し側の仕事 */
  test("渡された順 (新しい順) のまま行を並べる", () => {
    renderWithLocale(
      <AdminInquiriesPage
        authorized
        page={1}
        hasNext={false}
        inquiries={[
          inquiry({ id: 3, body: "新しい", receivedAt: "2026-09-20T02:00:00.000Z" }),
          inquiry({ id: 2, body: "中間", receivedAt: "2026-09-20T01:00:00.000Z" }),
          inquiry({ id: 1, body: "古い", receivedAt: "2026-09-20T00:00:00.000Z" }),
        ]}
      />,
    );

    const bodies = within(table())
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[2]?.textContent);
    expect(bodies).toEqual(["新しい", "中間", "古い"]);
  });

  /** 未記入と「読み落とし」を見分けられるよう、空欄のままにしない */
  test("連絡先が無い行は欄を空にせず未記入と出す", () => {
    renderWithLocale(
      <AdminInquiriesPage
        authorized
        page={1}
        hasNext={false}
        inquiries={[inquiry({ contact: undefined })]}
      />,
    );

    const cells = within(table()).getAllByRole("cell");
    expect(cells).toHaveLength(4);
    expect(cells[3]).toHaveTextContent("未記入");
  });

  test("1 件も無ければ表ごと出さない", () => {
    renderWithLocale(<AdminInquiriesPage authorized page={1} hasNext={false} inquiries={[]} />);

    expect(screen.getByText("まだ問い合わせは届いていない。")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  test("英語でも列の見出しが訳される", () => {
    renderWithLocale(
      <AdminInquiriesPage authorized page={1} hasNext={false} inquiries={[inquiry()]} />,
      "en",
    );

    expect(within(table()).getByText("Received")).toBeInTheDocument();
    expect(within(table()).getByText("Request")).toBeInTheDocument();
  });
});

describe("AdminInquiriesPage のページ送り", () => {
  test("続きがあるときだけ次のページへの行き先を出す", () => {
    renderWithLocale(<AdminInquiriesPage authorized page={1} hasNext inquiries={[inquiry()]} />);

    expect(screen.getByRole("link", { name: "次のページ" })).toHaveAttribute(
      "href",
      "/admin/inquiries?page=2",
    );
    expect(screen.queryByRole("link", { name: "前のページ" })).not.toBeInTheDocument();
  });

  test("続きが無ければ次のページへの行き先を出さない", () => {
    renderWithLocale(
      <AdminInquiriesPage authorized page={1} hasNext={false} inquiries={[inquiry()]} />,
    );

    expect(screen.queryByRole("link", { name: "次のページ" })).not.toBeInTheDocument();
  });

  /** 1 ページ目は欄なしの URL に戻す。同じ画面が 2 つの住所を持たないようにする */
  test("2 ページ目から戻る行き先にはページ番号を付けない", () => {
    renderWithLocale(<AdminInquiriesPage authorized page={2} hasNext inquiries={[inquiry()]} />);

    expect(screen.getByRole("link", { name: "前のページ" })).toHaveAttribute(
      "href",
      "/admin/inquiries",
    );
    expect(screen.getByRole("link", { name: "次のページ" })).toHaveAttribute(
      "href",
      "/admin/inquiries?page=3",
    );
    expect(screen.getByText("2 ページ目")).toBeInTheDocument();
  });

  test("3 ページ目から戻る行き先は 2 ページ目", () => {
    renderWithLocale(
      <AdminInquiriesPage authorized page={3} hasNext={false} inquiries={[inquiry()]} />,
    );

    expect(screen.getByRole("link", { name: "前のページ" })).toHaveAttribute(
      "href",
      "/admin/inquiries?page=2",
    );
  });
});

describe("AdminInquiriesPage の導線", () => {
  test("他の管理画面への行き先を出し、自分自身へは出さない", () => {
    renderWithLocale(<AdminInquiriesPage authorized page={1} hasNext={false} inquiries={[]} />);

    expect(screen.getByRole("link", { name: "クローラー健全性へ" })).toHaveAttribute(
      "href",
      "/admin/crawler-health",
    );
    expect(screen.getByRole("link", { name: "未解決クレジットへ" })).toHaveAttribute(
      "href",
      "/admin/unmatched-credits",
    );
    expect(screen.queryByRole("link", { name: "問い合わせへ" })).not.toBeInTheDocument();
  });
});
