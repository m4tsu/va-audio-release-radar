import { describe, expect, test } from "vitest";
import {
  categoryLabel,
  formatDateTime,
  formatDuration,
  formatMonthDay,
  formatPrice,
  formatReleaseDate,
  isUnreadSince,
} from "./format";

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

describe("formatMonthDay", () => {
  test("年を落として月日だけにする", () => {
    expect(formatMonthDay("2026-10-01")).toBe("10月1日");
  });
});

describe("isUnreadSince", () => {
  const now = "2026-09-18T00:00:00.000Z";
  const lastSeen = "2026-09-10T00:00:00.000Z";
  const oldSeen = "2026-01-01T00:00:00.000Z";

  test("前回見たとき以降に発売された作品は未読", () => {
    expect(isUnreadSince({ releaseDate: "2026-09-15" }, oldSeen, lastSeen, now)).toBe(true);
    expect(isUnreadSince({ releaseDate: "2026-09-05" }, oldSeen, lastSeen, now)).toBe(false);
  });

  test("発売日が無ければ見つけた日時で判定する", () => {
    expect(isUnreadSince({}, "2026-09-15T00:00:00.000Z", lastSeen, now)).toBe(true);
    expect(isUnreadSince({}, "2026-09-05T00:00:00.000Z", lastSeen, now)).toBe(false);
    expect(isUnreadSince({}, undefined, lastSeen, now)).toBe(false);
  });

  /** 未来の発売日で比べると、発売日が来るまでずっと未読のままになってしまう */
  test("発売前の作品は見つけた日時で判定する", () => {
    expect(isUnreadSince({ releaseDate: "2026-10-01" }, oldSeen, lastSeen, now)).toBe(false);
    expect(
      isUnreadSince({ releaseDate: "2026-10-01" }, "2026-09-15T00:00:00.000Z", lastSeen, now),
    ).toBe(true);
  });

  test("このブラウザで初めて見るときは印を出さない", () => {
    expect(isUnreadSince({ releaseDate: "2026-09-17" }, undefined, null, now)).toBe(false);
  });
});

describe("categoryLabel", () => {
  test("カテゴリを日本語にする", () => {
    expect(categoryLabel("asmr")).toBe("ASMR");
    expect(categoryLabel("audiobook")).toBe("朗読");
  });

  test("英語では英語にする", () => {
    expect(categoryLabel("audiobook", "en")).toBe("Audiobook");
    expect(categoryLabel("audio_drama", "en")).toBe("Audio drama");
    // ASMR は英語圏でもそのままの語
    expect(categoryLabel("asmr", "en")).toBe("ASMR");
  });
});

/** 言語を渡さない呼び出しは日本語のまま (上の describe 群がそれを見ている) */
describe("英語表示", () => {
  test("再生時間の単位が変わる", () => {
    expect(formatDuration(29520, "en")).toBe("8 hr 12 min");
    expect(formatDuration(2700, "en")).toBe("45 min");
    expect(formatDuration(7200, "en")).toBe("2 hr");
  });

  test("発売日は英語の書式になる", () => {
    expect(formatReleaseDate("2026-09-01", "en")).toBe("September 1, 2026");
    expect(formatMonthDay("2026-10-01", "en")).toBe("Oct 1");
  });

  /** 日付は UTC のまま組み立てる。実行環境のタイムゾーンで前日にずれないこと */
  test("日付はタイムゾーンでずれない", () => {
    expect(formatReleaseDate("2026-01-01", "en")).toBe("January 1, 2026");
    expect(formatReleaseDate("2026-01-01")).toBe("2026年1月1日");
    expect(formatMonthDay("2026-01-01")).toBe("1月1日");
  });

  test("価格は通貨を変えない (売っているのは日本のストア)", () => {
    expect(formatPrice(1584, "en")).toBe("¥1,584");
  });

  /** 価格の取得時点は言語を問わず JST で読ませる */
  test("日時は言語が変わっても JST のまま", () => {
    const iso = "2026-09-18T04:30:00.000Z";
    expect(formatDateTime(iso)).toContain("13:30");
    expect(formatDateTime(iso, "en")).toContain("1:30");
  });

  test("読めない日付はそのまま返す", () => {
    expect(formatReleaseDate("", "en")).toBe("");
    expect(formatMonthDay("not-a-date", "en")).toBe("not-a-date");
  });
});
