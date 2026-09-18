import { describe, expect, it } from "vitest";
import { dayNumber, estimateRjBoundary, shiftDays } from "./run.ts";

describe("shiftDays", () => {
  it("90 日前を出す", () => {
    expect(shiftDays("2026-09-18", -90)).toBe("2026-06-20");
  });

  it("月をまたいでも合う", () => {
    expect(shiftDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("dayNumber", () => {
  it("1 日ずれると 1 増える", () => {
    expect(dayNumber("2026-09-18") - dayNumber("2026-09-17")).toBe(1);
  });
});

describe("estimateRjBoundary", () => {
  it("実測の (RJ 番号, 発売日) から境界を推定する", () => {
    // 2026-09-18 に取得した product.json の実測値。1 日あたり 900 番前後で進む
    const samples = [
      { rjNumber: 1599356, registDate: "2026-05-29" },
      { rjNumber: 1653766, registDate: "2026-07-29" },
      { rjNumber: 1678210, registDate: "2026-07-27" },
      { rjNumber: 1698658, registDate: "2026-08-22" },
      { rjNumber: 1695509, registDate: "2026-09-03" },
    ];
    const boundary = estimateRjBoundary(samples, "2026-06-20");
    expect(boundary).toBeDefined();
    expect(boundary?.sampleCount).toBe(5);
    // 5 月末が RJ160 万、8 月末が RJ170 万なので、6/20 は 161〜166 万に入るはず
    expect(boundary?.rjNumber).toBeGreaterThan(1_610_000);
    expect(boundary?.rjNumber).toBeLessThan(1_660_000);
    expect(boundary?.slopePerDay).toBeGreaterThan(0);
  });

  it("サンプルが 1 件以下なら推定しない", () => {
    expect(
      estimateRjBoundary([{ rjNumber: 1, registDate: "2026-01-01" }], "2026-01-01"),
    ).toBeUndefined();
  });

  it("全サンプルが同じ日なら傾きを出せないので推定しない", () => {
    expect(
      estimateRjBoundary(
        [
          { rjNumber: 1, registDate: "2026-01-01" },
          { rjNumber: 2, registDate: "2026-01-01" },
        ],
        "2026-01-01",
      ),
    ).toBeUndefined();
  });
});
