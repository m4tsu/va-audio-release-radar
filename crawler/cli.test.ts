import { describe, expect, it } from "vitest";
import type { RawWork } from "../src/domain/index.ts";
import type { AdapterResult } from "./adapters/types.ts";
import { formatActorOutput } from "./cli.ts";

function work(storeProductId: string, titleRaw: string, releaseDate?: string): RawWork {
  return {
    storeSlug: "dlsite",
    storeProductId,
    titleRaw,
    productUrl: `https://example.com/${storeProductId}`,
    creditedNames: [],
    ageRating: "general",
    fetchedAt: "2026-09-18T00:00:00.000Z",
    releaseDate,
  };
}

function result(partial: Partial<AdapterResult> & Pick<AdapterResult, "storeSlug">): AdapterResult {
  return {
    actorName: "上田麗奈",
    status: "ok",
    works: [],
    invalidCount: 0,
    warnings: [],
    ...partial,
  };
}

describe("formatActorOutput", () => {
  it("ストアごとに新しい順に並べる", () => {
    const output = formatActorOutput([
      result({
        storeSlug: "dlsite",
        works: [work("RJ2", "古いほう", "2026-08-28"), work("RJ1", "新しいほう", "2026-09-10")],
      }),
      result({ storeSlug: "audible", works: [work("B1", "オーディブル作品", "2026-09-05")] }),
    ]);

    expect(output).toBe(
      "DLsite\n2026-09-10  新しいほう\n2026-08-28  古いほう\n\nAudible\n2026-09-05  オーディブル作品\n",
    );
  });

  it("発売日が取れなかった作品は末尾に置き、日付欄を伏せる", () => {
    const output = formatActorOutput([
      result({
        storeSlug: "dlsite",
        works: [work("RJ1", "日付なし"), work("RJ2", "日付あり", "2026-01-01")],
      }),
    ]);
    expect(output).toBe("DLsite\n2026-01-01  日付あり\n----------  日付なし\n");
  });

  it("取得に失敗したストアは理由を出す", () => {
    const output = formatActorOutput([
      result({ storeSlug: "audible", status: "error", reason: "302 に飛ばされた" }),
    ]);
    expect(output).toBe("Audible\n(取得できませんでした: 302 に飛ばされた)\n");
  });

  it("該当なし (empty) は失敗ではなく理由付きの 0 件として出す", () => {
    const output = formatActorOutput([
      result({ storeSlug: "audible", status: "empty", reason: "ナレーター検索に該当なし" }),
    ]);
    expect(output).toBe("Audible\n(該当作品なし: ナレーター検索に該当なし)\n");
  });

  it("0 件のストアはその旨を出す", () => {
    expect(formatActorOutput([result({ storeSlug: "dlsite" })])).toBe("DLsite\n(該当作品なし)\n");
  });
});
