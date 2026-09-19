import { describe, expect, it } from "vitest";
import type { StaffRecord } from "./anilist.ts";
import {
  type DlsiteWorkRecord,
  describeDistribution,
  filterTargetWorks,
  indexWorksByName,
  intersect,
  isWithinWindow,
  pearson,
  percentile,
  rank,
  spearman,
} from "./intersect.ts";

const WINDOW_START = "2026-06-20";

function work(partial: Partial<DlsiteWorkRecord> & { workno: string }): DlsiteWorkRecord {
  return {
    registDate: "2026-08-01",
    workType: "SOU",
    ageCategory: 1,
    voiceNames: [],
    genres: [],
    ...partial,
  };
}

describe("isWithinWindow", () => {
  it("境界日は含む", () => {
    expect(isWithinWindow("2026-06-20", WINDOW_START)).toBe(true);
    expect(isWithinWindow("2026-06-19", WINDOW_START)).toBe(false);
  });

  it("発売日が取れない作品は数えない", () => {
    expect(isWithinWindow(undefined, WINDOW_START)).toBe(false);
  });
});

describe("filterTargetWorks", () => {
  it("SOU かつ全年齢かつ期間内だけを残す", () => {
    const works = [
      work({ workno: "RJ1" }),
      work({ workno: "RJ2", workType: "MUS" }),
      work({ workno: "RJ3", ageCategory: 2 }),
      work({ workno: "RJ4", registDate: "2026-01-01" }),
      work({ workno: "RJ5", registDate: undefined }),
    ];
    expect(filterTargetWorks(works, WINDOW_START).map((w) => w.workno)).toEqual(["RJ1"]);
  });
});

describe("indexWorksByName", () => {
  it("空白の有無を吸収して同じ人にまとめる", () => {
    const index = indexWorksByName([
      work({ workno: "RJ1", voiceNames: ["上田麗奈"] }),
      work({ workno: "RJ2", voiceNames: ["上田 麗奈"] }),
    ]);
    expect(index.size).toBe(1);
    const stat = [...index.values()][0];
    expect(stat?.worknos).toEqual(["RJ1", "RJ2"]);
    expect(stat?.displayNames).toEqual(["上田麗奈", "上田 麗奈"]);
    // Audible 検索に使うため、空白入りの表記を覚えておく
    expect(stat?.spacedName).toBe("上田 麗奈");
  });

  it("同じ作品に同名が 2 回出ても 1 件として数える", () => {
    const index = indexWorksByName([
      work({ workno: "RJ1", voiceNames: ["上田麗奈", "上田 麗奈"] }),
    ]);
    expect([...index.values()][0]?.worknos).toEqual(["RJ1"]);
  });
});

describe("intersect", () => {
  function staff(
    partial: Partial<StaffRecord> & { anilistStaffId: number; nativeName: string },
  ): StaffRecord {
    return {
      roleCount: 1,
      mainRoleCount: 0,
      latestSeason: "2026 SUMMER",
      mediaCount: 1,
      ambiguous: false,
      ...partial,
    };
  }

  const worksByName = indexWorksByName([
    work({ workno: "RJ1", voiceNames: ["上田麗奈", "同人声優A"] }),
    work({ workno: "RJ2", voiceNames: ["上田 麗奈"] }),
    work({ workno: "RJ3", voiceNames: ["同人声優A", "佐藤健"] }),
  ]);

  it("正規化した名前で突き合わせ、作品数の多い順に並べる", () => {
    const result = intersect(
      [
        staff({ anilistStaffId: 10, nativeName: "上田麗奈", roleCount: 5 }),
        staff({ anilistStaffId: 20, nativeName: "居ない人" }),
      ],
      worksByName,
    );
    expect(result.rows.map((row) => row.nativeName)).toEqual(["上田麗奈"]);
    expect(result.rows[0]?.workCount).toBe(2);
    expect(result.anilistOnlyCount).toBe(1);
  });

  it("ambiguous な staff は別枠にする", () => {
    const result = intersect(
      [staff({ anilistStaffId: 30, nativeName: "佐藤健", ambiguous: true })],
      worksByName,
    );
    expect(result.rows).toHaveLength(0);
    expect(result.ambiguousRows.map((row) => row.nativeName)).toEqual(["佐藤健"]);
  });

  it("交差しなかった DLsite 側の名前を作品数の多い順に返す", () => {
    const result = intersect([staff({ anilistStaffId: 10, nativeName: "上田麗奈" })], worksByName);
    expect(result.dlsiteOnly.map((stat) => stat.displayNames[0])).toEqual(["同人声優A", "佐藤健"]);
    expect(result.dlsiteOnly[0]?.worknos).toHaveLength(2);
  });
});

describe("describeDistribution", () => {
  it("中央値とパーセンタイルを出す", () => {
    expect(describeDistribution([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toMatchObject({
      count: 10,
      sum: 55,
      median: 5,
      p75: 8,
      p90: 9,
      max: 10,
    });
  });

  it("空なら 0 を返す", () => {
    expect(describeDistribution([]).median).toBe(0);
  });
});

describe("percentile", () => {
  it("1 件のときはその値", () => {
    expect(percentile([7], 0.9)).toBe(7);
  });
});

describe("rank", () => {
  it("同順位は平均順位にする", () => {
    expect(rank([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
  });
});

describe("pearson / spearman", () => {
  it("完全に比例していれば 1", () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
    expect(spearman([1, 2, 3], [5, 6, 9])).toBeCloseTo(1);
  });

  it("分散が 0 なら相関を定義しない", () => {
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeUndefined();
  });

  it("2 件未満なら定義しない", () => {
    expect(pearson([1], [1])).toBeUndefined();
  });
});
