import type {
  fetchActorBySlug,
  fetchActorStoreCoverage,
  fetchAllActors,
} from "@/app/server-fns/actors";
import type {
  fetchCrawlerHealth,
  fetchExcludedCreditNames,
  fetchUnmatchedCredits,
} from "@/app/server-fns/admin";
import type {
  fetchAnimeByActor,
  fetchAnimeBySlug,
  fetchAnimeForActors,
  fetchAnimeSeasons,
  fetchSeasonAnime,
} from "@/app/server-fns/anime";
import type {
  fetchFeed,
  fetchLatestWorks,
  fetchWork,
  fetchWorkStatsForActors,
  fetchWorksByActor,
} from "@/app/server-fns/works";

/**
 * 画面が扱うデータの型。
 *
 * 元の定義は `@/server/queries/*` にあるが、そこは D1 に触るサーバー専用コードで
 * vite.config.ts の importProtection によりクライアントから import できない。
 * server function の戻り値から型だけを取り出せば、画面とサーバーの契約が
 * server-fns の 1 箇所に集まり、import の経路も増えない
 */

/** 作品カードが出せる最小の形。新着 (`LatestWork`) とフィード (`FeedItem`) はこれに声優を足したもの */
export type WorkWithListings = Awaited<ReturnType<typeof fetchWorksByActor>>[number];
export type LatestWork = Awaited<ReturnType<typeof fetchLatestWorks>>[number];
export type WorkSummary = WorkWithListings["work"];
export type WorkListing = WorkWithListings["listings"][number];
export type WorkDetail = NonNullable<Awaited<ReturnType<typeof fetchWork>>>;
export type WorkCredit = WorkDetail["credits"][number];
export type FeedItem = Awaited<ReturnType<typeof fetchFeed>>[number];
/** 声優 1 人の作品数と最新リリース。作品が 1 件も無い声優のぶんは返ってこない */
export type ActorWorkStats = Awaited<ReturnType<typeof fetchWorkStatsForActors>>[number];

export type ActorSummary = Awaited<ReturnType<typeof fetchAllActors>>[number];
export type ActorDetail = NonNullable<Awaited<ReturnType<typeof fetchActorBySlug>>>;
/** ストア 1 つぶんの網羅の状態。走行の記録が無いストアは含まれない */
export type ActorStoreCoverage = Awaited<ReturnType<typeof fetchActorStoreCoverage>>[number];

export type UnmatchedCreditGroup = Awaited<ReturnType<typeof fetchUnmatchedCredits>>[number];
export type ExcludedCreditName = Awaited<ReturnType<typeof fetchExcludedCreditNames>>[number];
export type CrawlerHealth = Awaited<ReturnType<typeof fetchCrawlerHealth>>;
export type CrawlerHealthEntry = CrawlerHealth["entries"][number];

export type AnimeSummary = Awaited<ReturnType<typeof fetchAnimeForActors>>[number];
/** シーズン一覧の 1 件。フォローの印を画面が付けられるよう、出演者 ID を持つ */
export type SeasonAnime = Awaited<ReturnType<typeof fetchSeasonAnime>>[number];
export type AnimeSeasonEntry = Awaited<ReturnType<typeof fetchAnimeSeasons>>[number];
export type AnimeDetail = NonNullable<Awaited<ReturnType<typeof fetchAnimeBySlug>>>;
export type AnimeCastMember = AnimeDetail["cast"][number];
export type ActorAnimeAppearance = Awaited<ReturnType<typeof fetchAnimeByActor>>[number];
