import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { audibleAdapter } from "../adapters/audible.ts";
import { parseProductJson } from "../adapters/dlsite.ts";
import { fetchText } from "../lib/fetch.ts";
import { CACHE_DIR, CRAWLER_DIR, SNAPSHOT_DIR, safeFileName } from "../lib/paths.ts";
import {
  aggregateStaff,
  crawlAniList,
  enumerateSeasons,
  queryFingerprint,
  SEASON_PAGE_QUERY,
  type SeasonCredit,
  type SeasonKey,
  type SeasonMedia,
  type StaffRecord,
} from "./anilist.ts";
import { crawlSitemap } from "./dlsite-sitemap.ts";
import {
  type DlsiteWorkRecord,
  describeDistribution,
  filterTargetWorks,
  type IntersectionRow,
  indexWorksByName,
  intersect,
  pearson,
  spearman,
} from "./intersect.ts";

/**
 * 発見スパイク。**研究専用で、定常の取り込みからは呼ばない。**
 *
 *   node crawler/discovery/run.ts --limit 1500 --audible
 *
 * 実行日を 2026-09-18 に固定して測定を再現するためのもので、DB には書かない。
 * 対象声優とアニメを台帳に入れる定常の経路は `crawler/anilist.ts` (週次)。
 *
 * 「対象声優 = AniList にアニメ出演がある日本語声優 ∩ DLsite 全年齢音声の voice_by」を
 * 機械的に決められるか、その交差がフィードを維持できる規模かを実データで数える。
 * DB には一切書き込まない。結果は crawler/.cache/discovery/ と docs/research/ に置く
 */

const DISCOVERY_DIR = path.join(CACHE_DIR, "discovery");
const ANILIST_STAFF_JSON = path.join(DISCOVERY_DIR, "anilist-staff.json");
const ANILIST_CREDITS_JSON = path.join(DISCOVERY_DIR, "anilist-credits.json");
const SITEMAP_JSON = path.join(DISCOVERY_DIR, "dlsite-sitemap.json");
const DLSITE_WORKS_JSON = path.join(DISCOVERY_DIR, "dlsite-works.json");
const REPORT_PATH = path.resolve(CRAWLER_DIR, "..", "docs/research/discovery-spike-2026-09-18.md");

/** 集計の基準日。スパイクの実行日 */
const TODAY = "2026-09-18";
const WINDOW_DAYS = 90;
/** 交差の上位何人を表に出すか */
const TOP_ROWS = 60;
/** Audible を引く人数 (交差上位) */
const AUDIBLE_SAMPLE = 20;
/** キャッシュ無しで通しで走らせたときの実測 (2026-09-18)。再生成すると所要時間が短く出るため併記する */
const FULL_RUN_MINUTES = 64;
/** DLsite 側だけの名前の上位何件を表に出すか */
const DLSITE_ONLY_ROWS = 20;
/** RJ 番号と発売日の関係を測るための先頭サンプル数 */
const CALIBRATION_SAMPLE = 200;
/** 二分探索で日付の取れない作品に当たったとき、後ろへずらして試す回数 */
const BOUNDARY_PROBE_STEPS = 12;
/**
 * 二分探索で見つけた境界の先をどれだけ余分に取るか。
 * RJ 番号の並びと発売順には局所的な逆転 (実測で最大 2 週間ぶん) があるため
 */
const BOUNDARY_MARGIN = 200;

const USAGE = `使い方:
  node crawler/discovery/run.ts [オプション]

オプション:
  --limit <N>       product.json を取る上限件数 (既定 1500)
  --seasons <N>     AniList の対象シーズン数 (既定 12 = 2024 WINTER 〜 2026 FALL)
  --media <N>       1 シーズンあたりの作品数 (既定 100)
  --audible         交差上位のうちシードに居ない ${AUDIBLE_SAMPLE} 人を Audible で引く
  --anilist-only    AniList の取得だけを行い、交差もレポート書き出しもしない
  --refresh         .cache/discovery の中間結果を使わず取り直す
                    (DLsite の sitemap と product.json も取り直すので時間がかかる)
  --no-snapshot     生データを .cache/snapshots に保存しない
`;

const OPTION_SPEC = {
  limit: { type: "string" },
  seasons: { type: "string" },
  media: { type: "string" },
  audible: { type: "boolean" },
  "anilist-only": { type: "boolean" },
  refresh: { type: "boolean" },
  "no-snapshot": { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

// --- 日付 ------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;

/** "2026-09-18" を epoch からの日数にする。RJ 番号との回帰に使う */
export function dayNumber(isoDate: string): number {
  return Math.round(Date.parse(`${isoDate}T00:00:00Z`) / MS_PER_DAY);
}

export function shiftDays(isoDate: string, days: number): string {
  const shifted = new Date((dayNumber(isoDate) + days) * MS_PER_DAY);
  return shifted.toISOString().slice(0, 10);
}

// --- RJ 番号 → 発売日の推定 ------------------------------------------------

export type CalibrationSample = { rjNumber: number; registDate: string };

export type RjBoundary = {
  /** この番号以上を「対象期間内の可能性がある」として扱う */
  rjNumber: number;
  /** 1 日あたり進む RJ 番号 */
  slopePerDay: number;
  sampleCount: number;
  note: string;
};

/**
 * サンプルから「対象期間の開始日に対応する RJ 番号」を最小二乗法で推定する。
 *
 * RJ 番号は発売順に増えるが等間隔ではない (成人向けも同じ採番を使うため、全年齢だけを
 * 見ていると飛ぶ)。日付で直接絞れない以上、番号で当たりを付けてから product.json で
 * 実際の発売日を確かめるしかない。推定はあくまで取得件数を決めるためのもので、
 * 期間の判定は必ず regist_date で行う
 */
export function estimateRjBoundary(
  samples: readonly CalibrationSample[],
  windowStartIso: string,
): RjBoundary | undefined {
  const points = samples.map((sample) => ({
    x: dayNumber(sample.registDate),
    y: sample.rjNumber,
  }));
  if (points.length < 2) return undefined;

  const meanX = points.reduce((total, point) => total + point.x, 0) / points.length;
  const meanY = points.reduce((total, point) => total + point.y, 0) / points.length;
  let covariance = 0;
  let varianceX = 0;
  for (const point of points) {
    covariance += (point.x - meanX) * (point.y - meanY);
    varianceX += (point.x - meanX) ** 2;
  }
  if (varianceX === 0) return undefined;

  const slope = covariance / varianceX;
  const intercept = meanY - slope * meanX;
  const estimated = slope * dayNumber(windowStartIso) + intercept;

  return {
    // 推定より手前まで取る。境界を跨いだ作品を取りこぼすより、余分に確かめるほうが安全
    rjNumber: Math.floor(estimated),
    slopePerDay: slope,
    sampleCount: points.length,
    note: `${points.length} 件の (RJ 番号, regist_date) から最小二乗法で推定`,
  };
}

/** 二分探索で境界を探したときに実際に引いた作品 */
export type BoundaryProbe = {
  index: number;
  workno: string;
  rjNumber: number;
  registDate?: string;
};

/**
 * RJ 番号の降順に並べた作品列から「発売日が対象期間より前になる最初の位置」を二分探索で探す。
 *
 * 最小二乗法による外挿を使わないのは、手元で測れるのが先頭 200 件 = 直近 11 日ぶんしかなく、
 * そこから 90 日先を外挿すると誤差が大きいため (実測で 1 日あたり 635 と 934 の 2 通りの
 * 傾きが出て、境界が 2.6 万番ずれた)。二分探索なら 20 件ほど引くだけで実際の発売日から
 * 位置が決まる。RJ 番号の並びと発売順には局所的な逆転があるので、見つけた位置から
 * さらに ${0} 件ぶん余分に取り、最終的な期間の判定は regist_date で行う
 */
async function findWindowBoundaryIndex(
  sorted: readonly { workno: string; rjNumber: number }[],
  windowStartIso: string,
  loadDate: (workno: string) => Promise<string | undefined>,
): Promise<{ index: number; probes: BoundaryProbe[] }> {
  const probes: BoundaryProbe[] = [];

  /** product.json が `[]` を返す作品があるので、日付が取れるまで少し後ろへずらす */
  const dateAt = async (index: number): Promise<{ index: number; date: string } | undefined> => {
    for (let offset = 0; offset < BOUNDARY_PROBE_STEPS; offset += 1) {
      const entry = sorted[index + offset];
      if (entry === undefined) return undefined;
      const registDate = await loadDate(entry.workno);
      probes.push({
        index: index + offset,
        workno: entry.workno,
        rjNumber: entry.rjNumber,
        ...(registDate === undefined ? {} : { registDate }),
      });
      if (registDate !== undefined) return { index: index + offset, date: registDate };
    }
    return undefined;
  };

  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const probe = await dateAt(mid);
    // 日付が取れる作品が後ろに無いなら、そこから先は対象外として扱う
    if (probe === undefined) {
      high = mid;
      continue;
    }
    if (probe.date >= windowStartIso) low = probe.index + 1;
    else high = mid;
  }
  return { index: low, probes };
}

// --- DLsite の取得 ---------------------------------------------------------

type DlsiteFetchStats = {
  requested: number;
  fromCache: number;
  fromNetwork: number;
  /** product.json が `[]` を返した件数。sitemap には載っているが API から引けない作品 */
  notFound: number;
  /** 取得そのものに失敗した件数 */
  failed: number;
};

/** product.json を 1 件取る。スナップショットが既にあれば再取得しない */
async function loadProductJson(
  workno: string,
  stats: DlsiteFetchStats,
  snapshot: boolean | undefined,
): Promise<DlsiteWorkRecord | undefined> {
  stats.requested += 1;
  const cachePath = path.join(SNAPSHOT_DIR, "dlsite", `${safeFileName(`product-${workno}`)}.json`);
  let body: string | undefined;
  try {
    body = await readFile(cachePath, "utf8");
    stats.fromCache += 1;
  } catch {
    const result = await fetchText(
      `https://www.dlsite.com/home/api/=/product.json?workno=${encodeURIComponent(workno)}`,
      { store: "dlsite", requestKey: `product-${workno}`, kind: "json", snapshot },
    );
    stats.fromNetwork += 1;
    if (!result.ok) {
      stats.failed += 1;
      return undefined;
    }
    body = result.body;
  }

  const detail = parseProductJson(body);
  if (detail === undefined) {
    // 実測では sitemap に載っている作品の約 17% で product.json が `[]` を返す
    // (予約ページなど)。取得の失敗とは区別して数える
    if (body.trim() === "[]") stats.notFound += 1;
    else stats.failed += 1;
    return undefined;
  }
  return {
    workno: detail.workno,
    ...(detail.releaseDate === undefined ? {} : { registDate: detail.releaseDate }),
    ...(detail.workName === undefined ? {} : { workName: detail.workName }),
    ...(detail.makerName === undefined ? {} : { makerName: detail.makerName }),
    ...(detail.workType === undefined ? {} : { workType: detail.workType }),
    ...(detail.ageCategory === undefined ? {} : { ageCategory: detail.ageCategory }),
    voiceNames: detail.voiceNames,
    genres: detail.genres,
  };
}

type DlsitePhaseResult = {
  sitemapChildCount: number;
  sitemapWorkCount: number;
  sitemapStats: Awaited<ReturnType<typeof crawlSitemap>>["stats"];
  sitemapWarnings: string[];
  /** 先頭 200 件からの最小二乗法による推定 (参考値。実際の絞り込みには使っていない) */
  boundary?: RjBoundary;
  /** 二分探索で決めた「対象期間に入る作品の件数」 */
  boundaryIndex: number;
  boundaryProbes: BoundaryProbe[];
  /** 実際に product.json を引いた件数の上限 (境界 + 余白 と limit の小さいほう) */
  targetCount: number;
  /** limit で打ち切ったか */
  truncated: boolean;
  works: DlsiteWorkRecord[];
  stats: DlsiteFetchStats;
};

async function runDlsitePhase(options: {
  limit: number;
  windowStartIso: string;
  refresh: boolean;
  snapshot: boolean | undefined;
}): Promise<DlsitePhaseResult> {
  console.log("[DLsite] sitemap を取得");
  const sitemap = await loadSitemap(options.refresh, options.snapshot);
  console.log(
    `[DLsite] 子 sitemap ${sitemap.childUrls.length} 本 / 作品 URL ${sitemap.entries.length} 件 (重複排除後)`,
  );

  const stats: DlsiteFetchStats = {
    requested: 0,
    fromCache: 0,
    fromNetwork: 0,
    notFound: 0,
    failed: 0,
  };
  const works: DlsiteWorkRecord[] = [];
  const sorted = sitemap.entries;

  // 1) 新しい順 200 件で RJ 番号と発売日の関係を測る
  console.log(`[DLsite] 先頭 ${CALIBRATION_SAMPLE} 件で RJ 番号と発売日の関係を測定`);
  const calibrationSamples: CalibrationSample[] = [];
  for (const entry of sorted.slice(0, CALIBRATION_SAMPLE)) {
    const work = await loadProductJson(entry.workno, stats, options.snapshot);
    if (work === undefined) continue;
    works.push(work);
    if (work.registDate !== undefined) {
      calibrationSamples.push({ rjNumber: entry.rjNumber, registDate: work.registDate });
    }
  }
  const boundary = estimateRjBoundary(calibrationSamples, options.windowStartIso);
  if (boundary === undefined) {
    console.warn("[DLsite] RJ 番号の傾きを推定できなかった (参考値のみ)");
  } else {
    console.log(
      `[DLsite] 参考: 最小二乗法の推定境界 RJ${boundary.rjNumber} (1 日あたり +${Math.round(boundary.slopePerDay)})`,
    );
  }

  // 2) 対象期間の終わりがどこかを二分探索で実測する
  const byWorkno = new Map(works.map((work) => [work.workno, work]));
  const loadDate = async (workno: string): Promise<string | undefined> => {
    const cached = byWorkno.get(workno);
    if (cached !== undefined) return cached.registDate;
    const loaded = await loadProductJson(workno, stats, options.snapshot);
    if (loaded === undefined) return undefined;
    works.push(loaded);
    byWorkno.set(workno, loaded);
    return loaded.registDate;
  };
  console.log("[DLsite] 対象期間の境界を二分探索");
  const { index: boundaryIndex, probes } = await findWindowBoundaryIndex(
    sorted,
    options.windowStartIso,
    loadDate,
  );
  const wanted = boundaryIndex + BOUNDARY_MARGIN;
  const targetCount = Math.min(options.limit, wanted, sorted.length);
  console.log(
    `[DLsite] 境界は先頭から ${boundaryIndex} 件目 (RJ${sorted[boundaryIndex]?.rjNumber ?? "-"})。` +
      ` 余白 ${BOUNDARY_MARGIN} を足した ${wanted} 件 / 上限 ${options.limit} 件 → ${targetCount} 件を対象にする`,
  );

  for (const [index, entry] of sorted.slice(CALIBRATION_SAMPLE, targetCount).entries()) {
    // 二分探索で引いた作品を二重に取らない
    if (byWorkno.has(entry.workno)) continue;
    const work = await loadProductJson(entry.workno, stats, options.snapshot);
    if (work !== undefined) {
      works.push(work);
      byWorkno.set(entry.workno, work);
    }
    const done = CALIBRATION_SAMPLE + index + 1;
    if (done % 100 === 0) {
      console.log(`[DLsite] ${done}/${targetCount} 件 (うちネットワーク ${stats.fromNetwork} 件)`);
    }
  }

  await writeJson(DLSITE_WORKS_JSON, works);
  return {
    sitemapChildCount: sitemap.childUrls.length,
    sitemapWorkCount: sitemap.entries.length,
    sitemapStats: sitemap.stats,
    sitemapWarnings: sitemap.warnings,
    ...(boundary === undefined ? {} : { boundary }),
    boundaryIndex,
    boundaryProbes: probes,
    targetCount,
    truncated: targetCount < wanted,
    works,
    stats,
  };
}

async function loadSitemap(
  refresh: boolean,
  snapshot: boolean | undefined,
): Promise<Awaited<ReturnType<typeof crawlSitemap>>> {
  if (!refresh) {
    // 子 sitemap は 1 本 18MB ある。中間結果があれば取り直さない
    const cached = await readJson<Awaited<ReturnType<typeof crawlSitemap>>>(SITEMAP_JSON);
    if (cached !== undefined) {
      console.log("[DLsite] .cache/discovery/dlsite-sitemap.json を再利用");
      return cached;
    }
  }
  const result = await crawlSitemap({ snapshot });
  await writeJson(SITEMAP_JSON, result);
  return result;
}

// --- AniList の取得 --------------------------------------------------------

type AniListPhaseResult = {
  /** 何件ずつ取ったか。中間結果を再利用してよいかの判定に使う */
  mediaPerSeason: number;
  seasons: SeasonKey[];
  mediaCount: number;
  mediaCountBySeason: Record<string, number>;
  /** 作品そのもの。集計後にタイトルを捨てないために持つ */
  media: SeasonMedia[];
  /** 取得に使ったクエリの指紋。取得項目を変えたら中間結果も作り直す */
  queryFingerprint: string;
  staff: StaffRecord[];
  withoutNativeName: number;
  requestCount: number;
  cachedCount: number;
  warnings: string[];
};

async function runAniListPhase(options: {
  seasons: SeasonKey[];
  mediaPerSeason: number;
  refresh: boolean;
  snapshot: boolean | undefined;
}): Promise<AniListPhaseResult> {
  if (!options.refresh) {
    const cached = await readJson<AniListPhaseResult>(ANILIST_STAFF_JSON);
    // 取得条件が違う中間結果を黙って使うと、シーズン数を増やしたのに数字が変わらないことになる。
    // クエリの指紋も見るのは、取得項目を増やしたときに「形は新しいが中身が古い」中間結果を
    // 再利用してしまうため (2026-09-18 に実際に踏んだ。キャラクター名が全件空のまま通った)
    const sameScope =
      cached !== undefined &&
      cached.mediaPerSeason === options.mediaPerSeason &&
      cached.seasons.length === options.seasons.length &&
      cached.queryFingerprint === queryFingerprint(SEASON_PAGE_QUERY);
    if (cached !== undefined && sameScope) {
      console.log("[AniList] .cache/discovery/anilist-staff.json を再利用");
      return cached;
    }
    if (cached !== undefined) {
      console.log(
        "[AniList] 中間結果の取得条件が違うので取り直す (個々のスナップショットは再利用)",
      );
    }
  }

  console.log(`[AniList] ${options.seasons.length} シーズンぶんの出演者を取得`);
  const crawled = await crawlAniList({
    seasons: options.seasons,
    mediaPerSeason: options.mediaPerSeason,
    snapshot: options.snapshot,
  });
  const { staff, withoutNativeName } = aggregateStaff(crawled.credits);

  const result: AniListPhaseResult = {
    mediaPerSeason: options.mediaPerSeason,
    seasons: crawled.seasons,
    mediaCount: crawled.mediaCount,
    mediaCountBySeason: crawled.mediaCountBySeason,
    media: crawled.media,
    queryFingerprint: queryFingerprint(SEASON_PAGE_QUERY),
    staff,
    withoutNativeName,
    requestCount: crawled.requestCount,
    cachedCount: crawled.cachedCount,
    warnings: crawled.warnings,
  };
  await writeJson(ANILIST_STAFF_JSON, result);
  // credit の生データも残す。集計の定義を変えたときに取り直さずに済ませるため
  await writeJson(ANILIST_CREDITS_JSON, crawled.credits satisfies SeasonCredit[]);
  return result;
}

// --- Audible --------------------------------------------------------------

type AudibleProbe = { nativeName: string; queryUsed?: string; status: string; workCount: number };

async function runAudiblePhase(
  rows: readonly IntersectionRow[],
  snapshot: boolean | undefined,
): Promise<AudibleProbe[]> {
  const probes: AudibleProbe[] = [];
  for (const row of rows) {
    // 空白入りの候補は AniList の fullName (ローマ字) からは作れないので、
    // DLsite 側の表記に空白があるときだけ足す (Audible 検索の揺れ対策)
    const searchNames =
      row.spacedName === undefined ? [row.nativeName] : [row.spacedName, row.nativeName];
    const result = await audibleAdapter.fetchByActor(
      { canonicalName: row.nativeName, searchNames },
      { snapshot },
    );
    probes.push({
      nativeName: row.nativeName,
      ...(result.queryUsed === undefined ? {} : { queryUsed: result.queryUsed }),
      status: result.status,
      workCount: result.works.length,
    });
    console.log(`  Audible ${row.nativeName}: ${result.status} / ${result.works.length} 件`);
  }
  return probes;
}

// --- 入出力 ----------------------------------------------------------------

async function readJson<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return undefined;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

// --- 本体 ------------------------------------------------------------------

export async function main(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({ args: [...argv], options: OPTION_SPEC, allowPositionals: false });
  if (values.help === true) {
    console.log(USAGE);
    return 0;
  }

  const limit = Number(values.limit ?? "1500");
  const seasonCount = Number(values.seasons ?? "12");
  const mediaPerSeason = Number(values.media ?? "100");
  const snapshot = values["no-snapshot"] === true ? false : undefined;
  const refresh = values.refresh === true;
  const windowStartIso = shiftDays(TODAY, -WINDOW_DAYS);

  // 2024 WINTER から数えて seasonCount 個ぶん (既定 12 = 2026 FALL まで)
  const allSeasons = enumerateSeasons(
    { year: 2024, season: "WINTER" },
    { year: 2026, season: "FALL" },
  );
  const seasons = allSeasons.slice(0, seasonCount);

  console.log(`対象期間: ${windowStartIso} 〜 ${TODAY} (${WINDOW_DAYS} 日)`);
  const startedAt = Date.now();

  // AniList だけを取り直したいときの経路 (アニメ導線のデータ生成の前段)。
  // 通しで走らせると DLsite にも出ていくうえ、docs/research/ の調査ノートを上書きしてしまう。
  // 調査ノートは実測の記録なので後から書き換えない (docs/README.md)
  if (values["anilist-only"] === true) {
    const anilistOnly = await runAniListPhase({ seasons, mediaPerSeason, refresh, snapshot });
    console.log(
      `[AniList] 作品 ${anilistOnly.media.length} 件 / 声優 ${anilistOnly.staff.length} 人 ` +
        `(リクエスト ${anilistOnly.requestCount} 回、キャッシュ ${anilistOnly.cachedCount} 回)`,
    );
    console.log(`書き出した: ${ANILIST_STAFF_JSON}`);
    console.log(`書き出した: ${ANILIST_CREDITS_JSON}`);
    return 0;
  }

  // AniList と DLsite はレート制限の枠が別なので同時に走らせる。合計時間が半分近くになる
  const [anilist, dlsite] = await Promise.all([
    runAniListPhase({ seasons, mediaPerSeason, refresh, snapshot }),
    runDlsitePhase({ limit, windowStartIso, refresh, snapshot }),
  ]);

  const targetWorks = filterTargetWorks(dlsite.works, windowStartIso);
  const worksByName = indexWorksByName(targetWorks);
  const result = intersect(anilist.staff, worksByName);

  const audibleTargets = result.rows.slice(0, AUDIBLE_SAMPLE);
  const audibleProbes =
    values.audible === true ? await runAudiblePhase(audibleTargets, snapshot) : [];

  const elapsedMinutes = (Date.now() - startedAt) / 60_000;
  const report = buildReport({
    windowStartIso,
    anilist,
    dlsite,
    targetWorks,
    worksByName,
    result,
    audibleProbes,
    elapsedMinutes,
    limit,
  });
  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, report, "utf8");
  console.log(`\n研究ノートを書き出した: ${REPORT_PATH}`);
  console.log(`所要 ${elapsedMinutes.toFixed(1)} 分`);
  return 0;
}

// --- 報告の組み立て --------------------------------------------------------

type ReportInput = {
  windowStartIso: string;
  anilist: AniListPhaseResult;
  dlsite: DlsitePhaseResult;
  targetWorks: DlsiteWorkRecord[];
  worksByName: Map<
    string,
    ReturnType<typeof indexWorksByName> extends Map<string, infer V> ? V : never
  >;
  result: ReturnType<typeof intersect>;
  audibleProbes: AudibleProbe[];
  elapsedMinutes: number;
  limit: number;
};

function buildReport(input: ReportInput): string {
  const { anilist, dlsite, result, targetWorks } = input;
  const weeks = WINDOW_DAYS / 7;

  const intersectedWorknos = new Set<string>();
  for (const row of result.rows) for (const workno of row.worknos) intersectedWorknos.add(workno);
  const ambiguousWorknos = new Set<string>();
  for (const row of result.ambiguousRows) {
    for (const workno of row.worknos) ambiguousWorknos.add(workno);
  }

  const workCounts = result.rows.map((row) => row.workCount);
  const distribution = describeDistribution(workCounts);
  const allNameCounts = [...input.worksByName.values()].map((stat) => stat.worknos.length);
  const allNameDistribution = describeDistribution(allNameCounts);
  const roleCounts = result.rows.map((row) => row.roleCount);
  const pearsonValue = pearson(roleCounts, workCounts);
  const spearmanValue = spearman(roleCounts, workCounts);

  // Audible を引いたのは交差上位の一部だけなので、引いていない人は "-" にする
  const audibleByName = new Map(input.audibleProbes.map((probe) => [probe.nativeName, probe]));
  const audibleCell = (nativeName: string): string => {
    const probe = audibleByName.get(nativeName);
    if (probe === undefined) return "-";
    if (probe.status === "error") return "取得失敗";
    return `${probe.workCount}`;
  };

  const lines: string[] = [];
  const push = (...values: string[]) => lines.push(...values);

  push(
    "# 発見スパイク: AniList × DLsite sitemap の交差 (2026-09-18)",
    "",
    "対象声優の定義 (AniList × DLsite の交差、当時の案) を実データで確かめた記録。DB には書き込んでいない。",
    "",
    `- 集計対象期間: **${input.windowStartIso} 〜 ${TODAY}** (${WINDOW_DAYS} 日 = ${weeks.toFixed(1)} 週)`,
    `- 実行: \`node crawler/discovery/run.ts --limit ${input.limit}${input.audibleProbes.length > 0 ? " --audible" : ""}\``,
    `- この出力の所要時間: 約 ${input.elapsedMinutes.toFixed(0)} 分`,
    `- キャッシュ無しの通し実行は **${FULL_RUN_MINUTES} 分** (2026-09-18 実施)。AniList と DLsite は`,
    "  レート制限の枠が別なので同時に走らせており、全体の時間は DLsite への間隔で決まる",
    "  (この 64 分は product.json を 2 秒間隔で引いていた頃の実測。その後 robots.txt の",
    "  Crawl-delay: 10 に揃えたため、いま同じことをすればもっとかかる)",
    `- 外部へのリクエスト: AniList ${anilist.requestCount + anilist.cachedCount} 件、DLsite ${dlsite.stats.requested + dlsite.sitemapStats.length + 1} 件 (sitemap ${dlsite.sitemapStats.length + 1} 本を含む)、Audible ${input.audibleProbes.length} 件`,
    "",
    "## 1. 結論",
    "",
    `- 交差した声優: **${result.rows.length} 人** (同名で曖昧なもの ${result.ambiguousRows.length} 人は別枠)`,
    `- その ${WINDOW_DAYS} 日の DLsite 全年齢音声作品: **${intersectedWorknos.size} 件 = 週 ${(intersectedWorknos.size / weeks).toFixed(1)} 件**`,
    `- 1 人あたりの作品数: 中央値 ${distribution.median} 件、上位 25% は ${distribution.p75} 件以上、最大 ${distribution.max} 件`,
    `- \`roleCount\` (アニメでの役の多さ) と DLsite の作品数はほぼ無相関 (スピアマン ${formatCorrelation(spearmanValue)})。**主役級ほど音声作品が多い、ということはない**`,
    "",
    "## 2. AniList 側 (需要側)",
    "",
    `| 項目 | 値 |`,
    `|---|---:|`,
    `| 対象シーズン | ${anilist.seasons.length} (${anilist.seasons[0] === undefined ? "-" : `${anilist.seasons[0].year} ${anilist.seasons[0].season}`} 〜 ${anilist.seasons.at(-1) === undefined ? "-" : `${anilist.seasons.at(-1)?.year} ${anilist.seasons.at(-1)?.season}`}) |`,
    `| 作品数 | ${anilist.mediaCount} |`,
    `| 日本語声優 (staff id で異なり) | ${anilist.staff.length} |`,
    `| うち同名の別 staff が居る | ${anilist.staff.filter((person) => person.ambiguous).length} |`,
    `| nativeName が無く突き合わせ不能 | ${anilist.withoutNativeName} |`,
    `| GraphQL リクエスト数 | ${anilist.requestCount} (ほかにスナップショット再利用 ${anilist.cachedCount}) |`,
    "",
    "シーズンごとの作品数:",
    "",
    "| シーズン | 作品数 |",
    "|---|---:|",
    ...Object.entries(anilist.mediaCountBySeason).map(
      ([label, count]) => `| ${label} | ${count} |`,
    ),
    "",
  );

  if (anilist.warnings.length > 0) {
    push(
      `取得中の警告 ${anilist.warnings.length} 件 (先頭 5 件):`,
      "",
      ...anilist.warnings.slice(0, 5).map((warning) => `- ${warning}`),
      "",
    );
  }

  push(
    "## 3. DLsite 側 (供給側)",
    "",
    "| 項目 | 値 |",
    "|---|---:|",
    `| sitemap index の子 sitemap | ${dlsite.sitemapChildCount} 本 |`,
    `| 作品 URL (重複排除後) | ${dlsite.sitemapWorkCount} 件 |`,
    `| 対象期間の境界 (二分探索で実測) | 新しい順 ${dlsite.boundaryIndex} 件目 |`,
    `| 参考: 先頭 ${CALIBRATION_SAMPLE} 件の外挿による推定境界 | ${dlsite.boundary === undefined ? "推定できず" : `RJ${dlsite.boundary.rjNumber} (1 日あたり +${Math.round(dlsite.boundary.slopePerDay)})`} |`,
    `| 取得対象にした件数 | ${dlsite.targetCount}${dlsite.truncated ? " (--limit で打ち切り)" : ""} |`,
    `| product.json を引いた件数 | ${dlsite.stats.requested} (ネットワーク ${dlsite.stats.fromNetwork} / スナップショット再利用 ${dlsite.stats.fromCache}) |`,
    `| うち API が \`[]\` を返した (引けない作品) | ${dlsite.stats.notFound} |`,
    `| うち取得に失敗 | ${dlsite.stats.failed} |`,
    `| うち ${WINDOW_DAYS} 日以内の SOU 全年齢 | ${targetWorks.length} 件 |`,
    `| voice_by の異なり名前数 | ${input.worksByName.size} |`,
    "",
    "子 sitemap ごとの内訳:",
    "",
    "| sitemap | URL 数 | 作品数 | RJ 最小 | RJ 最大 |",
    "|---|---:|---:|---:|---:|",
    ...dlsite.sitemapStats.map(
      (stat) =>
        `| ${stat.url.split("/").at(-1) ?? stat.url} | ${stat.urlCount} | ${stat.workCount} | ${stat.minRjNumber ?? "-"} | ${stat.maxRjNumber ?? "-"} |`,
    ),
    "",
    `voice_by の名前 1 つあたりの作品数 (${WINDOW_DAYS} 日以内、交差前の全員):`,
    "",
    "| 中央値 | 上位 25% | 上位 10% | 最大 | 平均 |",
    "|---:|---:|---:|---:|---:|",
    `| ${allNameDistribution.median} | ${allNameDistribution.p75} | ${allNameDistribution.p90} | ${allNameDistribution.max} | ${allNameDistribution.mean.toFixed(2)} |`,
    "",
  );

  if (dlsite.sitemapWarnings.length > 0) {
    push("sitemap の警告:", "", ...dlsite.sitemapWarnings.map((warning) => `- ${warning}`), "");
  }

  push(
    "## 4. 交差",
    "",
    "| 項目 | 値 |",
    "|---|---:|",
    `| 交差した声優 (曖昧でない) | ${result.rows.length} 人 |`,
    `| 交差した声優 (同名で曖昧) | ${result.ambiguousRows.length} 人 |`,
    `| AniList に居るが DLsite に作品なし | ${result.anilistOnlyCount} 人 |`,
    `| DLsite に居るが AniList に無い名前 | ${result.dlsiteOnly.length} |`,
    `| 交差した声優の ${WINDOW_DAYS} 日作品数 | ${intersectedWorknos.size} 件 (週 ${(intersectedWorknos.size / weeks).toFixed(1)} 件) |`,
    `| 曖昧な声優ぶんを足した場合 | ${new Set([...intersectedWorknos, ...ambiguousWorknos]).size} 件 |`,
    `| 1 人あたり作品数 中央値 | ${distribution.median} |`,
    `| 同 上位 25% / 10% / 最大 | ${distribution.p75} / ${distribution.p90} / ${distribution.max} |`,
    `| roleCount と作品数の相関 (ピアソン) | ${formatCorrelation(pearsonValue)} |`,
    `| 同 (スピアマン順位相関) | ${formatCorrelation(spearmanValue)} |`,
    "",
    `### 交差の上位 ${TOP_ROWS} 人`,
    "",
    `\`Audible\` 列は \`--audible\` で実際に引いた人だけ入る (交差上位 ${AUDIBLE_SAMPLE} 人)。引いていない人は "-"。`,
    "",
    `| # | 名前 | AniList id | roleCount | 主役 | ${WINDOW_DAYS}日作品数 | Audible | 最新シーズン |`,
    "|---:|---|---:|---:|---:|---:|---:|---|",
    ...result.rows
      .slice(0, TOP_ROWS)
      .map(
        (row, index) =>
          `| ${index + 1} | ${row.nativeName} | ${row.anilistStaffId} | ${row.roleCount} | ${row.mainRoleCount} | ${row.workCount} | ${audibleCell(row.nativeName)} | ${row.latestSeason} |`,
      ),
    "",
  );

  if (result.ambiguousRows.length > 0) {
    push(
      "### 同名で曖昧な交差",
      "",
      "AniList に同じ `nativeName` を持つ staff が 2 人以上いる。名前でしか突き合わせられない以上、",
      "DLsite の作品がどちらの人のものか機械的には決まらないので対象から外している。",
      "",
      "| 名前 | AniList id | roleCount | 作品数 |",
      "|---|---:|---:|---:|",
      ...result.ambiguousRows
        .slice(0, 20)
        .map(
          (row) =>
            `| ${row.nativeName} | ${row.anilistStaffId} | ${row.roleCount} | ${row.workCount} |`,
        ),
      "",
    );
  }

  push(
    `## 5. 交差に入らなかった DLsite 側の名前 (上位 ${DLSITE_ONLY_ROWS})`,
    "",
    "「アニメと接続しない同人声優」の規模感。対象声優の定義ではフォロー対象にしないが、",
    "クレジット表記としては残す層。",
    "",
    "| # | 名前 | 作品数 |",
    "|---:|---|---:|",
    ...result.dlsiteOnly
      .slice(0, DLSITE_ONLY_ROWS)
      .map(
        (stat, index) =>
          `| ${index + 1} | ${stat.displayNames.join(" / ")} | ${stat.worknos.length} |`,
      ),
    "",
  );

  if (input.audibleProbes.length > 0) {
    push(
      "## 6. Audible の裏取り (交差上位)",
      "",
      "| 名前 | 検索に使った語 | 結果 | 作品数 |",
      "|---|---|---|---:|",
      ...input.audibleProbes.map(
        (probe) =>
          `| ${probe.nativeName} | ${probe.queryUsed ?? "-"} | ${probe.status} | ${probe.workCount} |`,
      ),
      "",
      `Audible に作品がある人: ${input.audibleProbes.filter((probe) => probe.workCount > 0).length} / ${input.audibleProbes.length}`,
      "",
      "この表は交差上位のうちシードに居ない声優だけを引いたもので、交差の判定には使っていない。",
      "当時の定義は「DLsite 全年齢音声か Audible に作品がある人」なので、Audible 側だけに",
      "作品がある声優は今回の交差には現れない。その層の規模は別途測る必要がある。",
      "",
    );
  }

  push(
    "## 7. 判断のメモ",
    "",
    "- **90 日境界の決め方 (一番迷った点)**: sitemap に発売日は無く、`lastmod` は再編集でも動くので",
    "  期間で直接絞れない。当初は「新しい順 200 件の (RJ 番号, regist_date) から最小二乗法で",
    "  90 日前の RJ 番号を推定する」方法を取ったが、**この 200 件は直近 11 日ぶんしか無く**",
    "  (2026-09-07 〜 2026-09-18)、そこから 90 日先を外挿すると誤差が大きすぎた。",
    `  実際、この 200 件から出る傾きは 1 日あたり +${dlsite.boundary === undefined ? "?" : Math.round(dlsite.boundary.slopePerDay)} で、`,
    "  別途キャッシュしてあった 8 月の作品 (RJ1698658 = 2026-08-22) と最新作の差から出る +934 と合わず、",
    "  境界の推定値が 2.6 万番 (= 約 1 か月) ずれた。そこで **RJ 番号の降順に並べた列に対する",
    "  二分探索**に切り替えた。20 件ほど product.json を引くだけで、推定ではなく実際の `regist_date` で",
    `  境界の位置 (${dlsite.boundaryIndex} 件目) が決まる。RJ 番号の並びと発売順には局所的な逆転が`,
    `  あるので、そこから ${BOUNDARY_MARGIN} 件ぶん余分に取り、最終的な期間の判定は必ず \`regist_date\` で行っている`,
    `- **取得の打ち切り**: ${dlsite.targetCount} 件を取得対象にした。` +
      (dlsite.truncated
        ? `\`--limit\` (${input.limit}) が効いているので、対象期間の作品を取りこぼしている。表の作品数は下限として読む`
        : "`--limit` は効いていないので、この期間の作品は sitemap に載っている範囲で全件見ている"),
    `- **sitemap に載っていても引けない作品**: product.json が \`[]\` を返す作品が ${dlsite.stats.notFound} 件あった`,
    `  (引いた ${dlsite.stats.requested} 件の ${((dlsite.stats.notFound / Math.max(1, dlsite.stats.requested)) * 100).toFixed(1)}%)。予約ページなど、一覧には出るが API には無いものと見られる。数から除いている`,
    "- **sitemap の網羅性を別経路で確認した**: 暫定シード 35 人の声優名検索から取った product.json のうち",
    "  対象期間の SOU 全年齢だったもの 14 件は、**14 件とも sitemap に載っていた**。",
    "  sitemap 経由の発見が検索経由より取りこぼすということは無い",
    "- **同名の扱い**: AniList に同じ `nativeName` を持つ staff が複数居るとき、DLsite の名前から",
    "  どちらか一方に決める方法が無い。誤って別人の作品を出すより取りこぼすほうが害が小さいので、",
    "  `ambiguous` として対象から外し、別に数えた (`src/domain/identity.ts` の 4 段階と同じ判断)",
    "- **突き合わせの鍵**: `normalizeName` の完全一致だけ。類似度も LLM も使っていない。",
    "  本番の名寄せと同じ基準なので、ここで出た人数はそのまま実装に持ち込める",
    "",
  );

  return `${lines.join("\n")}\n`;
}

function formatCorrelation(value: number | undefined): string {
  return value === undefined ? "定義できず" : value.toFixed(3);
}

// 直接実行されたときだけ動かす。テストから import しても走らないようにするため
const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
