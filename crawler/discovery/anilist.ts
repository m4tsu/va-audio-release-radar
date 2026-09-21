import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ANIME_FORMATS, type AnimeFormat, type VoiceActorGender } from "../../src/domain/index.ts";
import { fetchText } from "../lib/fetch.ts";
import { SNAPSHOT_DIR, safeFileName } from "../lib/paths.ts";

/**
 * AniList GraphQL から「直近シーズンのアニメに出ている日本語声優」を取る (発見スパイク)。
 *
 * 需要側。DLsite 側 (供給側) と名前で交差させて対象声優を機械的に決めるのが目的。
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
      title { native romaji english }
      synonyms
      format
      popularity
      startDate { year month day }
      endDate { year month day }
      coverImage { large color }
      characters(perPage: 25, sort: ROLE) {
        edges {
          role
          node { id name { native full } image { medium } }
          voiceActors(language: JAPANESE) { id name { native full } image { medium } gender }
        }
      }
    }
  }
}`;

// --- 応答の解析 (純粋関数) -------------------------------------------------

export type SeasonMediaRef = {
  id: number;
  titleNative?: string;
  /** slug の元。これが無い作品は URL を作れない */
  titleRomaji?: string;
  /** null のことが実際にある (2026-09-18 の実応答で確認) */
  titleEnglish?: string;
  /** 別名タイトル。空配列のことも多い (2026-09-20 の実応答で確認) */
  synonyms?: string[];
  /** TV / MOVIE / OVA など。AniList が知らない値を返したら落とす */
  format?: AnimeFormat;
  popularity?: number;
  /** "2026-10-02"。年月日が揃っているときだけ入る */
  startDate?: string;
  /** 放送中・未放送の作品では入らない */
  endDate?: string;
  coverImageUrl?: string;
  /** 表紙の代表色 ("#e4a128") */
  coverImageColor?: string;
};

/** 1 作品 × 1 キャラクター × 1 声優の出演 */
export type MediaCredit = {
  mediaId: number;
  staffId: number;
  characterId: number;
  nativeName?: string;
  fullName?: string;
  characterNameNative?: string;
  characterNameFull?: string;
  characterImageUrl?: string;
  actorImageUrl?: string;
  /**
   * 列挙に写した性別。AniList が値を持たない声優では undefined になる
   * (「その他」と区別するため、ここで "unknown" に倒さない)
   */
  gender?: VoiceActorGender;
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
    const title = asRecord(record?.title);
    const titleNative = asString(title?.native);
    const titleRomaji = asString(title?.romaji);
    const titleEnglish = asString(title?.english);
    const cover = asRecord(record?.coverImage);
    const coverImageUrl = asString(cover?.large);
    const coverImageColor = asString(cover?.color);
    const synonyms = asStringArray(record?.synonyms);
    const format = asAnimeFormat(record?.format);
    const popularity = asNumber(record?.popularity);
    const startDate = asFuzzyDate(record?.startDate);
    const endDate = asFuzzyDate(record?.endDate);
    media.push({
      id: mediaId,
      ...(titleNative === undefined ? {} : { titleNative }),
      ...(titleRomaji === undefined ? {} : { titleRomaji }),
      ...(titleEnglish === undefined ? {} : { titleEnglish }),
      ...(synonyms.length === 0 ? {} : { synonyms }),
      ...(format === undefined ? {} : { format }),
      ...(popularity === undefined ? {} : { popularity }),
      ...(startDate === undefined ? {} : { startDate }),
      ...(endDate === undefined ? {} : { endDate }),
      ...(coverImageUrl === undefined ? {} : { coverImageUrl }),
      ...(coverImageColor === undefined ? {} : { coverImageColor }),
    });
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
    const node = asRecord(edge?.node);
    // キャラクター id は (作品, キャラ, 声優) の一意キーに使う。
    // これが無い edge は voiceActors も埋まらない (冒頭の罠) ので落とす
    const characterId = asNumber(node?.id);
    if (characterId === undefined) continue;
    const characterName = asRecord(node?.name);
    const characterNameNative = asString(characterName?.native);
    const characterNameFull = asString(characterName?.full);
    const characterImageUrl = asString(asRecord(node?.image)?.medium);
    // 日本語声優が居ないキャラクターでは null か [] になる
    const actors = Array.isArray(edge?.voiceActors) ? edge.voiceActors : [];
    for (const rawActor of actors) {
      const actor = asRecord(rawActor);
      const staffId = asNumber(actor?.id);
      if (staffId === undefined) continue;
      const name = asRecord(actor?.name);
      const nativeName = asString(name?.native);
      const fullName = asString(name?.full);
      const actorImageUrl = asString(asRecord(actor?.image)?.medium);
      const gender = asVoiceActorGender(actor?.gender);
      credits.push({
        mediaId,
        staffId,
        characterId,
        ...(nativeName === undefined ? {} : { nativeName }),
        ...(fullName === undefined ? {} : { fullName }),
        ...(characterNameNative === undefined ? {} : { characterNameNative }),
        ...(characterNameFull === undefined ? {} : { characterNameFull }),
        ...(characterImageUrl === undefined ? {} : { characterImageUrl }),
        ...(actorImageUrl === undefined ? {} : { actorImageUrl }),
        ...(gender === undefined ? {} : { gender }),
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
  /** AniList が言っている性別を列挙に写したもの。言っていなければ "unknown" */
  gender: VoiceActorGender;
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

/** 作品にシーズンを添えたもの。シーズンは AniList の応答に無く、問い合わせた側しか知らない */
export type SeasonMedia = SeasonMediaRef & { season: SeasonKey };

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
    gender?: VoiceActorGender;
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
    // 同じ声優の credit は同じ値を持つ。最初に見た値を採り、言っていない credit で上書きしない
    accumulator.gender ??= credit.gender;
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
      gender: accumulator.gender ?? "unknown",
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
  /** 取得した作品そのもの。タイトルを集計後に捨てないために持つ */
  media: SeasonMedia[];
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
/**
 * クエリの指紋 (先頭 8 桁)。スナップショットの鍵に混ぜる。
 *
 * 鍵がシーズンとページだけだと、取得項目を増やしても古い応答が黙って返る。
 * 2026-09-18 に実際に踏んだ: キャラクター名とローマ字タイトルを足したのに
 * 「リクエスト 0 回 / キャッシュ 24 回」で通り、新しい項目が 0 件のまま生成まで進んだ。
 * クエリを変えれば鍵が変わるようにして、取り直しを強制する
 */
export function queryFingerprint(query: string): string {
  return createHash("sha1").update(query).digest("hex").slice(0, 8);
}

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
  const media: SeasonMedia[] = [];
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
        `season-${season.year}-${season.season}-p${page}-${queryFingerprint(SEASON_PAGE_QUERY)}`,
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
      for (const ref of kept) {
        // 続編が複数シーズンに出ることは無いが、先に見たシーズンを正として重複を除く
        if (seenMediaIds.has(ref.id)) continue;
        seenMediaIds.add(ref.id);
        media.push({ ...ref, season });
      }
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
    media,
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

/** 文字列の要素だけを残す。空文字や他の型が混じっていても、配列ごと捨てはしない */
function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const item of value) {
    const name = asString(item);
    if (name !== undefined) names.push(name.trim());
  }
  return names;
}

/**
 * AniList の `Staff.gender` を列挙に写す。
 *
 * AniList の値は自由記述の文字列で、しかも利用者が編集できる。そのまま保存すると
 * 表記の揺れがそのまま列挙になるので、女性・男性だけを名指しで拾い、
 * 読める値が入っていてどちらでもないものは "other" にする。
 * 空なら undefined を返し、「その他」と「AniList が言っていない」を呼び出し側で分けられるようにする
 */
export function asVoiceActorGender(value: unknown): VoiceActorGender | undefined {
  const raw = asString(value)?.trim().toLowerCase();
  if (raw === undefined) return undefined;
  if (raw === "female") return "female";
  if (raw === "male") return "male";
  return "other";
}

/** AniList が知っている形式だけを残す。増えた値を勝手に別の形式に丸めない */
function asAnimeFormat(value: unknown): AnimeFormat | undefined {
  const format = asString(value);
  return ANIME_FORMATS.find((candidate) => candidate === format);
}

/**
 * AniList の `FuzzyDate` を "2026-10-02" にする。
 *
 * year / month / day はそれぞれ null になりうる (放送前の作品の終了日は 3 つとも null。
 * 2026-09-20 の実応答で確認)。揃っていない日付を持たない理由は
 * `src/domain/types.ts` の `AnimeTitle`
 */
function asFuzzyDate(value: unknown): string | undefined {
  const date = asRecord(value);
  const year = asNumber(date?.year);
  const month = asNumber(date?.month);
  const day = asNumber(date?.day);
  if (year === undefined || month === undefined || day === undefined) return undefined;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
