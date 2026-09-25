import { describe, expect, test } from "vitest";
import { seasonAt } from "./season";

describe("seasonAt", () => {
  test("月からシーズンを決める", () => {
    expect(seasonAt(new Date("2026-01-15T00:00:00Z"))).toEqual({
      seasonYear: 2026,
      season: "WINTER",
    });
    expect(seasonAt(new Date("2026-04-01T00:00:00Z"))).toEqual({
      seasonYear: 2026,
      season: "SPRING",
    });
    expect(seasonAt(new Date("2026-09-20T00:00:00Z"))).toEqual({
      seasonYear: 2026,
      season: "SUMMER",
    });
    expect(seasonAt(new Date("2026-12-31T00:00:00Z"))).toEqual({
      seasonYear: 2026,
      season: "FALL",
    });
  });

  /** 動かす場所の時刻帯で結果が変わらないよう、日本時間の暦日で決める */
  test("日本時間で日付が変わった時点で次のシーズンに移る", () => {
    // 日本時間の 2026-10-01 00:00 (UTC では 9 月 30 日)
    expect(seasonAt(new Date("2026-09-30T15:00:00Z"))).toEqual({
      seasonYear: 2026,
      season: "FALL",
    });
    expect(seasonAt(new Date("2026-09-30T14:59:59Z"))).toEqual({
      seasonYear: 2026,
      season: "SUMMER",
    });
  });

  test("年をまたぐ", () => {
    // 日本時間の 2027-01-01 00:00
    expect(seasonAt(new Date("2026-12-31T15:00:00Z"))).toEqual({
      seasonYear: 2027,
      season: "WINTER",
    });
  });

  test("日時として読めなければ投げる", () => {
    expect(() => seasonAt(new Date("いつか"))).toThrow();
  });
});
