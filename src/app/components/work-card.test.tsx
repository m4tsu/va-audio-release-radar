import { screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { WorkCard } from "@/app/components/work-card";
import { workWithListings } from "@/app/test/fixtures";
import { renderWithLocale } from "@/app/test/render";

const item = workWithListings();

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
