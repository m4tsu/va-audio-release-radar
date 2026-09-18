import { describe, expect, test } from "vitest";
import { categoryLabel, formatDuration, formatPrice, formatReleaseDate, isNewWork } from "./format";

describe("formatPrice", () => {
  test("3 桁区切りで円記号を付ける", () => {
    expect(formatPrice(1584)).toBe("¥1,584");
    expect(formatPrice(0)).toBe("¥0");
  });
});

describe("formatDuration", () => {
  test("時間と分に分ける", () => {
    expect(formatDuration(29520)).toBe("8時間12分");
    expect(formatDuration(5160)).toBe("1時間26分");
  });

  test("1 時間未満は分だけ、ちょうどの時間は時間だけ", () => {
    expect(formatDuration(2700)).toBe("45分");
    expect(formatDuration(7200)).toBe("2時間");
  });

  test("0 以下は表示しない", () => {
    expect(formatDuration(0)).toBe("—");
  });
});

describe("formatReleaseDate", () => {
  test("ゼロ埋めを落とした和風の表記にする", () => {
    expect(formatReleaseDate("2026-09-01")).toBe("2026年9月1日");
  });
});

describe("isNewWork", () => {
  const now = Date.parse("2026-09-18T00:00:00Z");

  test("発売日が 7 日以内なら新着", () => {
    expect(isNewWork({ releaseDate: "2026-09-15" }, undefined, now)).toBe(true);
    expect(isNewWork({ releaseDate: "2026-09-01" }, undefined, now)).toBe(false);
  });

  test("発売日が無ければ初出日時で判定する", () => {
    expect(isNewWork({}, "2026-09-17T00:00:00Z", now)).toBe(true);
    expect(isNewWork({}, "2026-08-17T00:00:00Z", now)).toBe(false);
    expect(isNewWork({}, undefined, now)).toBe(false);
  });
});

describe("categoryLabel", () => {
  test("カテゴリを日本語にする", () => {
    expect(categoryLabel("asmr")).toBe("ASMR");
    expect(categoryLabel("audiobook")).toBe("朗読");
  });
});
