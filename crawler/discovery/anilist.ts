import { readFile } from "node:fs/promises";
import path from "node:path";
import { fetchText } from "../lib/fetch.ts";
import { SNAPSHOT_DIR, safeFileName } from "../lib/paths.ts";

/**
 * AniList GraphQL から「直近シーズンのアニメに出ている日本語声優」を取る (発見スパイク T9)。
 *
 * 設計書 §9 の需要側。DLsite 側 (供給側) と名前で交差させて対象声優を機械的に決めるのが目的。
 *
 * 2026-09-18 の実測で踏んだ罠: `characters { edges { role voiceActors(language: JAPANESE) } }`
 * とだけ書くと voiceActors が全件 null で返る。同じ edge で `node` も選ぶと埋まる
 * (AniList 側がキャラクターを読み込まないと声優を解決できない作りに見える)。
 * この 1 行の有無で結果が「0 人」と「数千人」に分かれるので `node { id }` は消さないこと。
 * 埋まりさえすれば Page の中でも解決されるので、1 シーズン 50 作品を 1 リクエストで取れる
 */

const ENDPOINT = "https://graphql.anilist.co";
const STORE = "anilist";

export const ANILIST_SEASONS = ["WINTER", "SPRING", "SUMMER", "FALL"] as const;
export type AniListSeason = (typeof ANILIST_SEASONS)[number];

export type SeasonKey = { year: number; season: AniListSeason };

/** "2026 SUMMER" のような人が読む表記 */
export function seasonLabel(key: SeasonKey): string {
  return `${key.year} ${key.season}`;
}

/** 新旧を比べるための順序値。年 × 4 + シーズン番号 */
export function seasonOrder(key: SeasonKey): number {
  return key.year * 4 + ANILIST_SEASONS.indexOf(key.season);
}

/** from から to まで (両端含む) のシーズンを古い順に並べる */
export function enumerateSeasons(from: SeasonKey, to: SeasonKey): SeasonKey[] {
  const result: SeasonKey[] = [];
  for (let order = seasonOrder(from); order <= seasonOrder(to); order += 1) {
    const year = Math.floor(order / 4);
    const season = ANILIST_SEASONS[order % 4];
    if (season === undefined) continue;
    result.push({ year, season });
  }
  return result;
}

// --- クエリ ----------------------------------------------------------------

/**
 * シーズンの人気順 media と、その出演声優。
 * `node { id }` を外すと voiceActors が null になるので消さないこと (上のコメント参照)
 */
export const SEASON_PAGE_QUERY = `query ($season: MediaSeason, $seasonYear: Int, $page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { currentPage lastPage hasNextPage total }
    media(type: ANIME, season: $season, seasonYear: $seasonYear, sort: POPULARITY_DESC, isAdult: false) {
      id
      title { native }
      characters(perPage: 25, sort: ROLE) {
        edges {
          role
          node { id }
          voiceActors(language: JAPANESE) { id name { native full } }
        }
      }
    }
  }
}`;

// --- 応答の解析 (純粋関数) -------------------------------------------------

export type SeasonMediaRef = { id: number; titleNative?: string };

export type MediaCredit = {
  mediaId: number;
  staffId: number;
  nativeName?: string;
  fullName?: string;
  /** "MAIN" | "SUPPORTING" | "BACKGROUND" など */
  role?: string;
};

/** `Page` の応答から作品と出演声優を取り出す。想定外の形は静かに捨てる */
export function parseSeasonPage(json: unknown): {
  media: SeasonMediaRef[];
  credits: MediaCredit[];
  hasNextPage: boolean;
} {
  const page = asRecord(asRecord(asRecord(json)?.data)?.Page);
  const pageInfo = asRecord(page?.pageInfo);
  const list = Array.isArray(page?.media) ? page.media : [];
  const media: SeasonMediaRef[] = [];
  const credits: MediaCredit[] = [];

  for (const raw of list) {
    const record = asRecord(raw);
    const mediaId = asNumber(record?.id);
    if (mediaId === undefined) continue;
    const titleNative = asString(asRecord(record?.title)?.native);
    media.push({ id: mediaId, ...(titleNative === undefined ? {} : { titleNative }) });
    credits.push(...parseCharacterEdges(record?.characters, mediaId));
  }

  return { media, credits, hasNextPage: pageInfo?.hasNextPage === true };
}

/** 1 作品ぶんの `characters.edges` から声優を取り出す */
function parseCharacterEdges(characters: unknown, mediaId: number): MediaCredit[] {
  const edges = asRecord(characters)?.edges;
  if (!Array.isArray(edges)) return [];

  const credits: MediaCredit[] = [];
  for (const rawEdge of edges) {
    const edge = asRecord(rawEdge);
    const role = asString(edge?.role);
    // 日本語声優が居ないキャラクターでは null か [] になる
    const actors = Array.isArray(edge?.voiceActors) ? edge.voiceActors : [];
    for (const rawActor of actors) {
      const actor = asRecord(rawActor);
      const staffId = asNumber(actor?.id);
      if (staffId === undefined) continue;
      const name = asRecord(actor?.name);
      const nativeName = asString(name?.native);
      const fullName = asString(name?.full);
      credits.push({
        mediaId,
        staffId,
        ...(nativeName === undefined ? {} : { nativeName }),
        ...(fullName === undefined ? {} : { fullName }),
        ...(role === undefined ? {} : { role }),
      });
    }
  }
  return credits;
}

/** GraphQL の `errors` を人が読む 1 行にする */
export function describeGraphqlErrors(json: unknown): string | undefined {
  const errors = asRecord(json)?.errors;
  if (!Array.isArray(errors) || errors.length === 0) return undefined;
  return errors
    .map((error) => asString(asRecord(error)?.message) ?? JSON.stringify(error))
    .join(" / ");
}

// --- 集計 (純粋関数) -------------------------------------------------------

export type StaffRecord = {
  anilistStaffId: number;
  /** 日本語表記。DLsite との突き合わせに使う唯一の鍵 */
  nativeName: string;
  fullName?: string;
  /** 演じたキャラクターの数 (作品をまたいで合計) */
  roleCount: number;
  /** そのうち MAIN 扱いのもの */
  mainRoleCount: number;
  /** 出演が確認できた一番新しいシーズン */
  latestSeason: string;
  /** 出演作品数 */
  mediaCount: number;
  /**
   * 同じ nativeName を別の staff id も持っている。
   * 名前でしか突き合わせられない以上、この人は「誰の作品か」を断定できない
   */
  ambiguous: boolean;
};

/** credit にシーズンを添えたもの。集計の入力 */
export type SeasonCredit = MediaCredit & { season: SeasonKey };

const MAIN_ROLE = "MAIN";

export function aggregateStaff(credits: readonly SeasonCredit[]): {
  staff: StaffRecord[];
  /** nativeName が無く突き合わせ不能だった staff の数 */
  withoutNativeName: number;
} {
  type Accumulator = {
    anilistStaffId: number;
    nativeName?: string;
    fullName?: string;
    roleCount: number;
    mainRoleCount: number;
    latestOrder: number;
    latestSeason: string;
    mediaIds: Set<number>;
  };

  const byStaffId = new Map<number, Accumulator>();
  for (const credit of credits) {
    const existing = byStaffId.get(credit.staffId);
    const order = seasonOrder(credit.season);
    const accumulator: Accumulator = existing ?? {
      anilistStaffId: credit.staffId,
      roleCount: 0,
      mainRoleCount: 0,
      latestOrder: Number.NEGATIVE_INFINITY,
      latestSeason: "",
      mediaIds: new Set<number>(),
    };
    accumulator.nativeName ??= credit.nativeName;
    accumulator.fullName ??= credit.fullName;
    accumulator.roleCount += 1;
    if (credit.role === MAIN_ROLE) accumulator.mainRoleCount += 1;
    accumulator.mediaIds.add(credit.mediaId);
    if (order > accumulator.latestOrder) {
      accumulator.latestOrder = order;
      accumulator.latestSeason = seasonLabel(credit.season);
    }
    byStaffId.set(credit.staffId, accumulator);
  }

  // 名前でしか DLsite と突き合わせられないので、同じ表記を持つ staff が複数居たら印を付ける
  const idsByName = new Map<string, Set<number>>();
  for (const accumulator of byStaffId.values()) {
    if (accumulator.nativeName === undefined) continue;
    const ids = idsByName.get(accumulator.nativeName) ?? new Set<number>();
    ids.add(accumulator.anilistStaffId);
    idsByName.set(accumulator.nativeName, ids);
  }

  const staff: StaffRecord[] = [];
  let withoutNativeName = 0;
  for (const accumulator of byStaffId.values()) {
    if (accumulator.nativeName === undefined) {
      withoutNativeName += 1;
      continue;
    }
    staff.push({
      anilistStaffId: accumulator.anilistStaffId,
      nativeName: accumulator.nativeName,
      ...(accumulator.fullName === undefined ? {} : { fullName: accumulator.fullName }),
      roleCount: accumulator.roleCount,
      mainRoleCount: accumulator.mainRoleCount,
      latestSeason: accumulator.latestSeason,
      mediaCount: accumulator.mediaIds.size,
      ambiguous: (idsByName.get(accumulator.nativeName)?.size ?? 1) > 1,
    });
  }

  staff.sort((a, b) => b.roleCount - a.roleCount || a.anilistStaffId - b.anilistStaffId);
  return { staff, withoutNativeName };
}

// --- 取得 ------------------------------------------------------------------

export type AniListCrawlResult = {
  seasons: SeasonKey[];
  /** シーズンごとの取得作品数 */
  mediaCountBySeason: Record<string, number>;
  /** 重複を除いた作品数 (続編が複数シーズンに出ることは無いが、念のため) */
  mediaCount: number;
  credits: SeasonCredit[];
  /** 実際にネットワークへ出た GraphQL リクエスト数 */
  requestCount: number;
  /** スナップショットで済ませた数 */
  cachedCount: number;
  warnings: string[];
};

/**
 * 保存済みのスナップショットがあればそれを使う。
 * 1,200 件超のリクエストを 1.5 秒間隔で投げるため 30 分かかる。途中で落ちたときに
 * 最初からやり直さずに済むよう、取得済みのものは再取得しない
 */
async function readSnapshot(requestKey: string): Promise<string | undefined> {
  try {
    return await readFile(
      path.join(SNAPSHOT_DIR, STORE, `${safeFileName(requestKey)}.json`),
      "utf8",
    );
  } catch {
    return undefined;
  }
}

async function postGraphql(
  query: string,
  variables: Record<string, unknown>,
  requestKey: string,
  snapshot: boolean | undefined,
  counters: { network: number; cache: number },
): Promise<{ json: unknown } | { error: string }> {
  let body = snapshot === false ? undefined : await readSnapshot(requestKey);
  if (body === undefined) {
    const result = await fetchText(ENDPOINT, {
      store: STORE,
      requestKey,
      kind: "json",
      method: "POST",
      body: JSON.stringify({ query, variables }),
      contentType: "application/json",
      snapshot,
    });
    counters.network += 1;
    if (!result.ok) return { error: result.reason };
    body = result.body;
  } else {
    counters.cache += 1;
  }

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch (error) {
    return { error: `JSON として読めない: ${String(error)}` };
  }
  const graphqlError = describeGraphqlErrors(json);
  // errors があっても data が部分的に返ることがあるので、警告として持ち上げつつ json は返す
  return graphqlError === undefined ? { json } : { json, error: graphqlError };
}

export async function crawlAniList(options: {
  seasons: SeasonKey[];
  /** シーズンごとに取る作品数の上限 (50 件 × ページ) */
  mediaPerSeason: number;
  snapshot?: boolean;
}): Promise<AniListCrawlResult> {
  const warnings: string[] = [];
  const credits: SeasonCredit[] = [];
  const mediaCountBySeason: Record<string, number> = {};
  const seenMediaIds = new Set<number>();
  const counters = { network: 0, cache: 0 };

  for (const season of options.seasons) {
    const label = seasonLabel(season);
    const pages = Math.ceil(options.mediaPerSeason / 50);
    let taken = 0;

    for (let page = 1; page <= pages; page += 1) {
      const response = await postGraphql(
        SEASON_PAGE_QUERY,
        { season: season.season, seasonYear: season.year, page },
        `season-${season.year}-${season.season}-p${page}`,
        options.snapshot,
        counters,
      );
      if ("error" in response && !("json" in response)) {
        warnings.push(`${label} p${page}: 取得に失敗 (${response.error})`);
        break;
      }
      if ("error" in response) {
        warnings.push(`${label} p${page}: GraphQL エラー (${response.error})`);
      }
      const parsed = parseSeasonPage("json" in response ? response.json : undefined);

      // 上限を超えたぶんは credit ごと落とす (人気順の上位から数えるため)
      const kept = parsed.media.slice(0, options.mediaPerSeason - taken);
      const keptIds = new Set(kept.map((ref) => ref.id));
      for (const ref of kept) seenMediaIds.add(ref.id);
      for (const credit of parsed.credits) {
        if (keptIds.has(credit.mediaId)) credits.push({ ...credit, season });
      }
      taken += kept.length;

      if (!parsed.hasNextPage || taken >= options.mediaPerSeason) break;
    }

    mediaCountBySeason[label] = taken;
    console.log(`  ${label}: 作品 ${taken} 件`);
  }

  return {
    seasons: options.seasons,
    mediaCountBySeason,
    mediaCount: seenMediaIds.size,
    credits,
    requestCount: counters.network,
    cachedCount: counters.cache,
    warnings,
  };
}

// --- 小物 ------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
