import type {
  ActorAnimeAppearance,
  ActorDetail,
  ActorSummary,
  AnimeCastMember,
  AnimeDetail,
  AnimeSeasonEntry,
  AnimeSummary,
  CrawlerHealth,
  CrawlerHealthEntry,
  FeedItem,
  LatestWork,
  SeasonAnime,
  UnmatchedCreditGroup,
  WorkCredit,
  WorkDetail,
  WorkListing,
  WorkSummary,
  WorkWithListings,
} from "@/app/lib/view-types";

/**
 * 画面のテストが使うデータ。
 *
 * 型の正は `@/app/lib/view-types` (= server function の戻り値) なので、サーバーが返す形が
 * 変われば、ここがコンパイルエラーになる。各関数は「最低限そろっている 1 件」を返し、
 * テストは見たい欄だけを上書きする。名前は E2E の固定データ (`e2e/fixtures/seed.sql`) とは
 * 別物にしてある。どちらを直しているのか取り違えないため
 */

/** 作品カードやフィードの並びが日付で変わるので、基準の日時を 1 つ置く */
export const NOW = "2026-09-20T00:00:00.000Z";

export function actorSummary(over: Partial<ActorSummary> = {}): ActorSummary {
  return {
    id: "va_alpha",
    slug: "alpha",
    canonicalName: "架空アルファ",
    status: "active",
    workCount: 3,
    storeSlugs: ["dlsite"],
    ...over,
  };
}

export function actorDetail(over: Partial<ActorDetail> = {}): ActorDetail {
  return {
    id: "va_alpha",
    slug: "alpha",
    canonicalName: "架空アルファ",
    status: "active",
    aliases: [],
    ...over,
  };
}

export function workSummary(over: Partial<WorkSummary> = {}): WorkSummary {
  return {
    id: "dlsite:RJ1",
    title: "架空のASMR作品",
    category: "asmr",
    ...over,
  };
}

export function workListing(over: Partial<WorkListing> = {}): WorkListing {
  return {
    storeSlug: "dlsite",
    storeProductId: "RJ1",
    productUrl: "https://www.dlsite.com/home/work/=/product_id/RJ1.html",
    titleRaw: "架空のASMR作品",
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    ...over,
  };
}

export function workWithListings(over: Partial<WorkWithListings> = {}): WorkWithListings {
  return {
    work: workSummary(),
    listings: [workListing()],
    freshness: "recent",
    isNew: false,
    // 既定は 1 人 = 単独。出演形態を見るテストはここを上書きする
    castSize: 1,
    ...over,
  };
}

export function latestWork(over: Partial<LatestWork> = {}): LatestWork {
  return { ...workWithListings(), actors: [], ...over };
}

export function feedItem(over: Partial<FeedItem> = {}): FeedItem {
  return { ...workWithListings(), actors: [], ...over };
}

export function workCredit(over: Partial<WorkCredit> = {}): WorkCredit {
  return {
    creditedName: "架空アルファ",
    confidence: "verified",
    sourceStoreSlug: "dlsite",
    voiceActorId: "va_alpha",
    voiceActorSlug: "alpha",
    voiceActorName: "架空アルファ",
    ...over,
  };
}

export function workDetail(over: Partial<WorkDetail> = {}): WorkDetail {
  return { ...workWithListings(), credits: [workCredit()], ...over };
}

export function animeSummary(over: Partial<AnimeSummary> = {}): AnimeSummary {
  return {
    slug: "kakuu-no-anime",
    titleNative: "架空のアニメ",
    titleRomaji: "Kakuu no Anime",
    seasonYear: 2026,
    season: "FALL",
    actorCount: 2,
    ...over,
  };
}

/** シーズン一覧の 1 件。出演者 ID は「フォロー中の声優が出ているか」の判定に使う */
export function seasonAnime(over: Partial<SeasonAnime> = {}): SeasonAnime {
  return { ...animeSummary(), actorIds: ["va_alpha", "va_beta"], ...over };
}

export function animeSeasonEntry(over: Partial<AnimeSeasonEntry> = {}): AnimeSeasonEntry {
  return { seasonYear: 2026, season: "FALL", animeCount: 3, ...over };
}

export function animeCastMember(over: Partial<AnimeCastMember> = {}): AnimeCastMember {
  return {
    characterId: "anilist:1",
    characterNameNative: "架空キャラ",
    role: "main",
    actor: { id: "va_alpha", slug: "alpha", canonicalName: "架空アルファ" },
    workCounts: [{ category: "asmr", count: 2 }],
    ...over,
  };
}

export function animeDetail(over: Partial<AnimeDetail> = {}): AnimeDetail {
  return { ...animeSummary(), cast: [animeCastMember()], ...over };
}

export function actorAnimeAppearance(
  over: Partial<ActorAnimeAppearance> = {},
): ActorAnimeAppearance {
  return {
    slug: "kakuu-no-anime",
    titleNative: "架空のアニメ",
    titleRomaji: "Kakuu no Anime",
    seasonYear: 2026,
    season: "FALL",
    characterNameNative: "架空キャラ",
    role: "main",
    ...over,
  };
}

export function unmatchedCreditGroup(
  over: Partial<UnmatchedCreditGroup> = {},
): UnmatchedCreditGroup {
  return {
    creditedName: "架空の未解決表記",
    sourceStoreSlug: "dlsite",
    count: 3,
    sampleWorks: [{ id: "dlsite:RJ1", title: "架空のASMR作品" }],
    ...over,
  };
}

type CrawlRunSummary = CrawlerHealthEntry["latest"];

export function crawlRunSummary(over: Partial<CrawlRunSummary> = {}): CrawlRunSummary {
  return {
    id: "run_1",
    startedAt: NOW,
    finishedAt: NOW,
    workCount: 12,
    newCount: 1,
    status: "ok",
    ...over,
  };
}

export function crawlerHealthEntry(over: Partial<CrawlerHealthEntry> = {}): CrawlerHealthEntry {
  return {
    storeSlug: "dlsite",
    voiceActorId: "va_alpha",
    voiceActorName: "架空アルファ",
    voiceActorSlug: "alpha",
    latest: crawlRunSummary(),
    warning: false,
    ...over,
  };
}

export function crawlerHealth(over: Partial<CrawlerHealth> = {}): CrawlerHealth {
  return {
    entries: [crawlerHealthEntry()],
    last24h: { ok: 1, error: 0 },
    ...over,
  };
}
