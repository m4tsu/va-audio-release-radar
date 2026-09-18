import type { fetchActorBySlug, fetchAllActors } from "@/app/server-fns/actors";
import type { fetchCrawlerHealth, fetchUnmatchedCredits } from "@/app/server-fns/admin";
import type { fetchFeed, fetchLatestWorks, fetchWork } from "@/app/server-fns/works";

/**
 * 画面が扱うデータの型。
 *
 * 元の定義は `@/server/queries/*` にあるが、そこは D1 に触るサーバー専用コードで
 * vite.config.ts の importProtection によりクライアントから import できない。
 * server function の戻り値から型だけを取り出せば、画面とサーバーの契約が
 * server-fns の 1 箇所に集まり、import の経路も増えない
 */

export type WorkWithListings = Awaited<ReturnType<typeof fetchLatestWorks>>[number];
export type WorkSummary = WorkWithListings["work"];
export type WorkListing = WorkWithListings["listings"][number];
export type WorkDetail = NonNullable<Awaited<ReturnType<typeof fetchWork>>>;
export type WorkCredit = WorkDetail["credits"][number];
export type FeedItem = Awaited<ReturnType<typeof fetchFeed>>[number];

export type ActorSummary = Awaited<ReturnType<typeof fetchAllActors>>[number];
export type ActorDetail = NonNullable<Awaited<ReturnType<typeof fetchActorBySlug>>>;

export type UnmatchedCreditGroup = Awaited<ReturnType<typeof fetchUnmatchedCredits>>[number];
export type CrawlerHealth = Awaited<ReturnType<typeof fetchCrawlerHealth>>;
export type CrawlerHealthEntry = CrawlerHealth["entries"][number];
