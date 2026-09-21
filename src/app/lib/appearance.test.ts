import { describe, expect, test } from "vitest";
import {
  APPEARANCE_FILTERS,
  appearanceFormat,
  appearanceLabel,
  isAppearanceFilter,
  matchesAppearance,
} from "@/app/lib/appearance";

describe("appearanceFormat", () => {
  test("クレジットが 1 件も無ければ不明。単独にはしない", () => {
    expect(appearanceFormat(0)).toBe("unknown");
  });

  test("1 人なら単独", () => {
    expect(appearanceFormat(1)).toBe("solo");
  });

  test("2 人から境界の人数までは少人数", () => {
    expect(appearanceFormat(2)).toBe("small");
    expect(appearanceFormat(3)).toBe("small");
    expect(appearanceFormat(4)).toBe("small");
  });

  test("境界を 1 人超えると大人数", () => {
    expect(appearanceFormat(5)).toBe("large");
    expect(appearanceFormat(20)).toBe("large");
  });

  /** 数えられなかった値を「単独」に倒すと、根拠の無い区分が画面に出る */
  test("負の数や数でない値は不明", () => {
    expect(appearanceFormat(-1)).toBe("unknown");
    expect(appearanceFormat(Number.NaN)).toBe("unknown");
  });
});

describe("appearanceLabel", () => {
  test("表示言語に合わせて訳す", () => {
    expect(appearanceLabel("solo")).toBe("単独");
    expect(appearanceLabel("solo", "en")).toBe("Solo");
    expect(appearanceLabel("unknown")).toBe("出演形態不明");
  });
});

describe("絞り込み", () => {
  test("判定しない区分は選択肢に出さない", () => {
    expect(APPEARANCE_FILTERS).toEqual(["all", "solo", "small", "large"]);
    expect(isAppearanceFilter("unknown")).toBe(false);
    expect(isAppearanceFilter("audiobook")).toBe(false);
    expect(isAppearanceFilter("solo")).toBe(true);
  });

  test("all は人数を問わず残す", () => {
    expect(matchesAppearance("all", 0)).toBe(true);
    expect(matchesAppearance("all", 9)).toBe(true);
  });

  test("区分を選ぶとその区分の作品だけ残る", () => {
    expect(matchesAppearance("solo", 1)).toBe(true);
    expect(matchesAppearance("solo", 2)).toBe(false);
    expect(matchesAppearance("small", 3)).toBe(true);
    expect(matchesAppearance("large", 5)).toBe(true);
    // 不明はどの区分にも入らない
    expect(matchesAppearance("solo", 0)).toBe(false);
    expect(matchesAppearance("large", 0)).toBe(false);
  });
});
