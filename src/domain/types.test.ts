import { describe, expect, test } from "vitest";
import { ingestPayloadSchema, rawWorkSchema } from "./types.ts";

function validRawWork() {
  return {
    storeSlug: "dlsite",
    storeProductId: "RJ01698658",
    titleRaw: "テスト作品",
    productUrl: "https://www.dlsite.com/home/work/=/product_id/RJ01698658.html",
    creditedNames: ["上田麗奈"],
    adult: false,
    fetchedAt: "2026-09-18T00:00:00.000Z",
  };
}

describe("rawWorkSchema", () => {
  test("必須項目だけの正規のデータを受け付ける", () => {
    const result = rawWorkSchema.safeParse(validRawWork());
    expect(result.success).toBe(true);
  });

  test("任意項目を含む正規のデータを受け付ける", () => {
    const result = rawWorkSchema.safeParse({
      ...validRawWork(),
      coverImageUrl: "https://img.dlsite.jp/example.jpg",
      releaseDate: "2026-08-22",
      durationSeconds: 3600,
      price: 1584,
      listPrice: 1980,
      makerName: "テストサークル",
      storeCategory: "SOU",
      genres: ["ボイスドラマ"],
    });
    expect(result.success).toBe(true);
  });

  test("storeSlug が未知の値なら拒否する", () => {
    const result = rawWorkSchema.safeParse({ ...validRawWork(), storeSlug: "unknown" });
    expect(result.success).toBe(false);
  });

  test("必須項目が欠けていれば拒否する", () => {
    const { titleRaw, ...rest } = validRawWork();
    expect(rawWorkSchema.safeParse(rest).success).toBe(false);
  });

  /**
   * productUrl / coverImageUrl は `<a href>` と `<img src>` にそのまま出る。
   * https 以外を通すとスクリプト実行や混在コンテンツの入口になる
   */
  test("productUrl が https でなければ拒否する", () => {
    for (const productUrl of [
      "http://www.dlsite.com/home/work/=/product_id/RJ01.html",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "/home/work/=/product_id/RJ01.html",
      "ただの文字列",
    ]) {
      expect(rawWorkSchema.safeParse({ ...validRawWork(), productUrl }).success).toBe(false);
    }
  });

  test("coverImageUrl も https のみ受け付ける", () => {
    expect(
      rawWorkSchema.safeParse({ ...validRawWork(), coverImageUrl: "http://img.dlsite.jp/a.jpg" })
        .success,
    ).toBe(false);
    expect(
      rawWorkSchema.safeParse({ ...validRawWork(), coverImageUrl: "https://img.dlsite.jp/a.jpg" })
        .success,
    ).toBe(true);
  });

  test("releaseDate は YYYY-MM-DD のみ受け付ける", () => {
    for (const releaseDate of ["2026/08/22", "2026-8-22", "2026-08-22 00:00:00", "近日発売"]) {
      expect(rawWorkSchema.safeParse({ ...validRawWork(), releaseDate }).success).toBe(false);
    }
    expect(rawWorkSchema.safeParse({ ...validRawWork(), releaseDate: "2026-08-22" }).success).toBe(
      true,
    );
  });
});

describe("ingestPayloadSchema", () => {
  test("正規のペイロードを受け付ける", () => {
    const result = ingestPayloadSchema.safeParse({
      runId: "run_1",
      storeSlug: "dlsite",
      voiceActorId: "va_ueda-reina",
      works: [validRawWork()],
    });
    expect(result.success).toBe(true);
  });

  test("取得失敗時 (works が空、error あり) を受け付ける", () => {
    const result = ingestPayloadSchema.safeParse({
      runId: "run_2",
      storeSlug: "audible",
      voiceActorId: "va_ueda-reina",
      works: [],
      error: "302 redirected to no-search-results",
    });
    expect(result.success).toBe(true);
  });

  test("works の中身が不正なら拒否する", () => {
    const result = ingestPayloadSchema.safeParse({
      runId: "run_3",
      storeSlug: "dlsite",
      voiceActorId: "va_ueda-reina",
      works: [{ ...validRawWork(), adult: "not-a-boolean" }],
    });
    expect(result.success).toBe(false);
  });
});
