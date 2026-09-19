import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";
import { WorkCard } from "@/app/components/work-card";
import { LocaleContext } from "@/app/i18n";
import type { WorkWithListings } from "@/app/lib/view-types";

/**
 * `Link` はルーターの文脈を要るので、行き先が読める `<a>` に置き換える。
 * ここで確かめたいのは「誰の名前を何人出すか」と「どこへ結ぶか」だけ
 */
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
  }: {
    to: string;
    params?: Record<string, string>;
    children: ReactNode;
  }) => <a href={to.replace(/\$(\w+)/g, (_, key: string) => params?.[key] ?? "")}>{children}</a>,
}));

const item: WorkWithListings = {
  work: { id: "dlsite:RJ1", title: "テスト作品", category: "asmr" },
  listings: [
    {
      storeSlug: "dlsite",
      storeProductId: "RJ1",
      productUrl: "https://www.dlsite.com/home/work/=/product_id/RJ1.html",
      titleRaw: "テスト作品",
      available: true,
      firstSeenAt: "2026-09-01T00:00:00.000Z",
      lastSeenAt: "2026-09-01T00:00:00.000Z",
    },
  ],
  freshness: "recent",
  isNew: false,
};

function actor(index: number) {
  return { id: `va_${index}`, slug: `actor-${index}`, name: `声優${index}` };
}

/** 声優ページへのリンクだけを拾う。作品名のリンクは行き先が違うので混ざらない */
function actorLinks() {
  return screen
    .getAllByRole("link")
    .filter((link) => link.getAttribute("href")?.startsWith("/voice-actors/"));
}

describe("WorkCard の出演声優", () => {
  test("渡された声優の名前を出し、その声優のページへ結ぶ", () => {
    render(<WorkCard item={item} actors={[actor(1), actor(2)]} />);

    expect(actorLinks().map((link) => link.textContent)).toEqual(["声優1", "声優2"]);
    expect(actorLinks()[0]).toHaveAttribute("href", "/voice-actors/actor-1");
  });

  test("actors を渡さなければ名前の行が出ない", () => {
    render(<WorkCard item={item} />);

    expect(actorLinks()).toHaveLength(0);
  });

  test("空の配列でも名前の行が出ない", () => {
    render(<WorkCard item={item} actors={[]} />);

    expect(actorLinks()).toHaveLength(0);
  });

  test("上限を渡すと先頭だけを出し、残りは人数で示す", () => {
    render(<WorkCard item={item} actors={[1, 2, 3, 4, 5].map(actor)} actorLimit={3} />);

    expect(actorLinks().map((link) => link.textContent)).toEqual(["声優1", "声優2", "声優3"]);
    expect(screen.getByText("他 2 名")).toBeInTheDocument();
  });

  test("上限に届かなければ人数を添えない", () => {
    render(<WorkCard item={item} actors={[actor(1), actor(2)]} actorLimit={3} />);

    expect(screen.queryByText(/他 \d+ 名/)).not.toBeInTheDocument();
  });

  /** 表記違いで同じ声優に解決された credit は、上限を数える前に 1 人に畳む */
  test("同じ声優が重複していても 1 回しか出さず、余りにも数えない", () => {
    const ueda = { id: "va_ueda", slug: "ueda-reina", name: "上田麗奈" };
    render(
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
    render(
      <LocaleContext value="en">
        <WorkCard
          item={item}
          actors={[
            { id: "va_ueda", slug: "ueda-reina", name: "上田麗奈", nameEn: "Reina Ueda" },
            { id: "va_kana", slug: "hanazawa-kana", name: "花澤香菜" },
          ]}
        />
      </LocaleContext>,
    );

    expect(actorLinks().map((link) => link.textContent)).toEqual(["Reina Ueda", "花澤香菜"]);
  });
});
