import { describe, expect, it } from "vitest";
import { digestScheduledAt, digestWindow } from "./slot";

/** 2026-09-25 は金曜。18:00 JST = 09:00 UTC */
const FRIDAY_SLOT = "2026-09-25T09:00:00.000Z";

describe("digestScheduledAt", () => {
  it("金曜 18:00 JST ちょうどならその時刻", () => {
    expect(digestScheduledAt(FRIDAY_SLOT)).toBe(FRIDAY_SLOT);
  });

  /** 持ち越しの起動 (18:10、18:50 ...) はどれも同じ予定時刻になる */
  it("金曜 18:00 JST より後の同じ日はその日の予定時刻", () => {
    expect(digestScheduledAt("2026-09-25T09:10:00.000Z")).toBe(FRIDAY_SLOT);
    expect(digestScheduledAt("2026-09-25T23:59:59.000Z")).toBe(FRIDAY_SLOT);
  });

  it("金曜 18:00 JST より前なら前の週の予定時刻", () => {
    expect(digestScheduledAt("2026-09-25T08:59:59.000Z")).toBe("2026-09-18T09:00:00.000Z");
  });

  it("週の途中なら直近の金曜", () => {
    expect(digestScheduledAt("2026-09-22T00:00:00.000Z")).toBe("2026-09-18T09:00:00.000Z");
    expect(digestScheduledAt("2026-09-28T12:00:00.000Z")).toBe(FRIDAY_SLOT);
  });
});

describe("digestWindow", () => {
  it("発売日は前の金曜の翌日からこの金曜まで (JST の日付)、発見日時は前の予定時刻より後", () => {
    expect(digestWindow(FRIDAY_SLOT)).toEqual({
      scheduledAt: FRIDAY_SLOT,
      releaseDateFrom: "2026-09-19",
      releaseDateTo: "2026-09-25",
      discoveredAfter: "2026-09-18T09:00:00.000Z",
      discoveredUntil: FRIDAY_SLOT,
    });
  });

  /** 発売日は JST の日付で入っている。UTC の日付で切ると金曜の作品が翌週に回る */
  it("日付の端は UTC ではなく JST で決める", () => {
    // 木曜 23:00 UTC = 金曜 08:00 JST の予定時刻はありえないが、日付の変換自体を見る
    const window = digestWindow("2026-09-24T15:30:00.000Z");
    expect(window.releaseDateTo).toBe("2026-09-25");
  });
});
