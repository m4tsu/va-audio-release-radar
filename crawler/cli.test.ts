import { describe, expect, it } from "vitest";
import type { RawWork } from "../src/contract/index.ts";
import type { AdapterResult } from "./adapters/types.ts";
import { formatActorOutput, formatCoverage } from "./cli.ts";

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

describe("formatCoverage", () => {
  it("総件数が取れていれば取りこぼしの有無を書く", () => {
    expect(formatCoverage({ fetched: 27, total: 27, complete: true, pages: 1 })).toBe(
      "取得 27 件 / 総件数 27 (完全、検索 1 ページ)",
    );
    expect(formatCoverage({ fetched: 30, total: 52, complete: false, pages: 2 })).toBe(
      "取得 30 件 / 総件数 52 (取りこぼしあり、検索 2 ページ)",
    );
  });

  it("総件数が取れなければ取りこぼしの有無を言わない", () => {
    expect(formatCoverage({ fetched: 3, pages: 1 })).toBe("取得 3 件 / 総件数不明 (検索 1 ページ)");
  });

  // 検索先の一部を引けなかった走行。総件数は分からないが取りこぼしは確かなので、
  // 「総件数が読めなかっただけの走行」と同じ文言にしない
  it("総件数が取れなくても取りこぼしが確かなら、そう書く", () => {
    expect(formatCoverage({ fetched: 3, complete: false, pages: 2 })).toBe(
      "取得 3 件 / 総件数不明・取りこぼしあり (検索 2 ページ)",
    );
  });
});
