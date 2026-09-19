import { normalizeName } from "../../src/domain/normalize.ts";
import type { StaffRecord } from "./anilist.ts";

/**
 * 需要側 (AniList) と供給側 (DLsite) を名前で突き合わせる (発見スパイク)。
 *
 * 突き合わせの鍵は `normalizeName` だけにする。ここで類似度や LLM に頼ると、
 * 本番の名寄せ (`src/domain/identity.ts`) と違う基準で数字が出てしまい、
 * スパイクの結論がそのまま実装に使えなくなるため
 */

/** DLsite の product.json から取った 1 作品 */
export type DlsiteWorkRecord = {
  workno: string;
  /** "2026-08-22"。product.json の regist_date の日付部分 */
  registDate?: string;
  workName?: string;
  makerName?: string;
  workType?: string;
  ageCategory?: number;
  voiceNames: string[];
  genres: string[];
};

/** 発売日が集計期間に入っているか。日付が取れない作品は数えない */
export function isWithinWindow(registDate: string | undefined, windowStartIso: string): boolean {
  if (registDate === undefined) return false;
  return registDate >= windowStartIso;
}

/** 対象期間の全年齢音声作品だけを残す */
export function filterTargetWorks(
  works: readonly DlsiteWorkRecord[],
  windowStartIso: string,
): DlsiteWorkRecord[] {
  return works.filter(
    (work) =>
      work.workType === "SOU" &&
      work.ageCategory === 1 &&
      isWithinWindow(work.registDate, windowStartIso),
  );
}

/** 名前 1 つぶんの DLsite 側の実績 */
export type DlsiteNameStat = {
  /** 正規化前の表記。複数あれば出現順 */
  displayNames: string[];
  normalized: string;
  worknos: string[];
  /** 空白入りの表記があればそれ (Audible 検索の候補に使う) */
  spacedName?: string;
};

/**
 * 正規化した名前ごとに作品をまとめる。
 * 「上田麗奈」と「上田 麗奈」は同じ人として 1 つにまとまる
 */
export function indexWorksByName(works: readonly DlsiteWorkRecord[]): Map<string, DlsiteNameStat> {
  const index = new Map<string, DlsiteNameStat>();
  for (const work of works) {
    // 同じ作品に同名が 2 回出ても 1 件として数える
    const seenInWork = new Set<string>();
    for (const rawName of work.voiceNames) {
      const normalized = normalizeName(rawName);
      if (normalized === "" || seenInWork.has(normalized)) continue;
      seenInWork.add(normalized);

      const stat = index.get(normalized) ?? { displayNames: [], normalized, worknos: [] };
      if (!stat.displayNames.includes(rawName)) stat.displayNames.push(rawName);
      // 空白入りの表記は Audible のナレーター検索で当たりやすい
      if (stat.spacedName === undefined && /\s/.test(rawName)) stat.spacedName = rawName;
      stat.worknos.push(work.workno);
      index.set(normalized, stat);
    }
  }
  return index;
}

/** 交差した声優 1 人ぶん */
export type IntersectionRow = {
  anilistStaffId: number;
  nativeName: string;
  fullName?: string;
  roleCount: number;
  mainRoleCount: number;
  mediaCount: number;
  latestSeason: string;
  ambiguous: boolean;
  /** 対象期間の DLsite 作品数 */
  workCount: number;
  worknos: string[];
  /** DLsite 側で見つかった表記 */
  dlsiteNames: string[];
  /** DLsite 側に空白入りの表記があればそれ */
  spacedName?: string;
};

export type IntersectionResult = {
  /** ambiguous でない交差 */
  rows: IntersectionRow[];
  /** 同名の別 staff が居るため断定できない交差 */
  ambiguousRows: IntersectionRow[];
  /** AniList に居たが DLsite に対象期間の作品が無かった声優の数 */
  anilistOnlyCount: number;
  /** DLsite に居たが AniList の対象シーズンに出ていない名前 */
  dlsiteOnly: DlsiteNameStat[];
};

export function intersect(
  staff: readonly StaffRecord[],
  worksByName: ReadonlyMap<string, DlsiteNameStat>,
): IntersectionResult {
  const rows: IntersectionRow[] = [];
  const ambiguousRows: IntersectionRow[] = [];
  const matchedNormalized = new Set<string>();
  let anilistOnlyCount = 0;

  for (const person of staff) {
    const normalized = normalizeName(person.nativeName);
    const stat = worksByName.get(normalized);
    if (stat === undefined) {
      anilistOnlyCount += 1;
      continue;
    }
    matchedNormalized.add(normalized);
    const row: IntersectionRow = {
      anilistStaffId: person.anilistStaffId,
      nativeName: person.nativeName,
      ...(person.fullName === undefined ? {} : { fullName: person.fullName }),
      roleCount: person.roleCount,
      mainRoleCount: person.mainRoleCount,
      mediaCount: person.mediaCount,
      latestSeason: person.latestSeason,
      ambiguous: person.ambiguous,
      workCount: stat.worknos.length,
      worknos: stat.worknos,
      dlsiteNames: stat.displayNames,
      ...(stat.spacedName === undefined ? {} : { spacedName: stat.spacedName }),
    };
    (person.ambiguous ? ambiguousRows : rows).push(row);
  }

  const byWorkCountDesc = (a: IntersectionRow, b: IntersectionRow) =>
    b.workCount - a.workCount ||
    b.roleCount - a.roleCount ||
    a.nativeName.localeCompare(b.nativeName);
  rows.sort(byWorkCountDesc);
  ambiguousRows.sort(byWorkCountDesc);

  const dlsiteOnly = [...worksByName.values()]
    .filter((stat) => !matchedNormalized.has(stat.normalized))
    .sort((a, b) => b.worknos.length - a.worknos.length);

  return { rows, ambiguousRows, anilistOnlyCount, dlsiteOnly };
}

// --- 分布 ------------------------------------------------------------------

export type Distribution = {
  count: number;
  sum: number;
  mean: number;
  median: number;
  p75: number;
  p90: number;
  max: number;
};

export function describeDistribution(values: readonly number[]): Distribution {
  if (values.length === 0) {
    return { count: 0, sum: 0, mean: 0, median: 0, p75: 0, p90: 0, max: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    sum,
    mean: sum / sorted.length,
    median: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

/** 昇順の配列に対する最近傍順位法のパーセンタイル */
export function percentile(sorted: readonly number[], ratio: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(ratio * sorted.length) - 1));
  return sorted[index] ?? 0;
}

/** ピアソンの積率相関。分散が 0 のとき (全員同じ値) は相関を定義できないので undefined */
export function pearson(xs: readonly number[], ys: readonly number[]): number | undefined {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return undefined;
  const meanX = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const meanY = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = (xs[i] ?? 0) - meanX;
    const dy = (ys[i] ?? 0) - meanY;
    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }
  if (varianceX === 0 || varianceY === 0) return undefined;
  return covariance / Math.sqrt(varianceX * varianceY);
}

/** 同順位は平均順位にする (スピアマン相関のため) */
export function rank(values: readonly number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index }));
  indexed.sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(values.length).fill(0);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1]?.value === indexed[i]?.value) j += 1;
    const averageRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) {
      const entry = indexed[k];
      if (entry !== undefined) ranks[entry.index] = averageRank;
    }
    i = j + 1;
  }
  return ranks;
}

/** 順位相関。作品数が裾の重い分布なのでピアソンだけでは判断しづらいため併記する */
export function spearman(xs: readonly number[], ys: readonly number[]): number | undefined {
  return pearson(rank(xs), rank(ys));
}
