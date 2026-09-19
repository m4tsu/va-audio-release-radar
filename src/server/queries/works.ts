import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import type { CreditConfidence, StoreSlug, WorkCategory } from "@/domain/types";
import { chunked } from "../db/chunked";
import { audioCredits, audioWorks, crawlRuns, storeListings, voiceActors } from "../db/schema";
import type { AppDb } from "../db/types";
import { hasAnyAudioCredit } from "./actors";

/**
 * 発売日を基準にした「新しさ」(設計書 §10)。画面の 3 段と NEW バッジはこの値だけで決める。
 *
 * クライアントで再計算すると SSR とハイドレーション後で結果がずれる (時計が違う) ため、
 * 判定はサーバーに寄せて値として配る
 */
export type Freshness = "upcoming" | "recent" | "older";

/** フィードが遡る日数。3 段目「それ以前」の下限 (設計書 §10) */
export const FEED_WINDOW_DAYS = 90;
/** 2 段目「30 日以内の新作」の幅 */
export const RECENT_DAYS = 30;
/** NEW バッジを出す日数。企画書 §6 の「今週の新着」に合わせる */
export const NEW_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 画面に出してよい作品の年齢区分 (設計書 §14)。R18 だけを除く形にしてあるのは、
 * 区分を読めなかった作品 ("unknown"。Audible は年齢区分を公開していない) を落とさないため。
 * 許可制にすると Audible の作品が丸ごと消える
 */
export const notAdultRated = ne(audioWorks.ageRating, "r18");

export type WorkSummary = {
  id: string;
  title: string;
  category: WorkCategory;
  releaseDate?: string;
  coverImageUrl?: string;
  durationSeconds?: number;
  makerName?: string;
};

export type WorkListing = {
  storeSlug: StoreSlug;
  storeProductId: string;
  productUrl: string;
  affiliateUrl?: string;
  titleRaw: string;
  price?: number;
  listPrice?: number;
  available: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type WorkWithListings = {
  work: WorkSummary;
  listings: WorkListing[];
  freshness: Freshness;
  /** NEW バッジ。発売日が 7 日以内、または発売日が無く 7 日以内に新しく見つかった作品 */
  isNew: boolean;
};

export type WorkCredit = {
  creditedName: string;
  role?: string;
  confidence: CreditConfidence;
  sourceStoreSlug: StoreSlug;
  voiceActorId?: string;
  /** 名寄せ済みなら声優ページへリンクできる */
  voiceActorSlug?: string;
  voiceActorName?: string;
};

export type WorkDetail = WorkWithListings & { credits: WorkCredit[] };

/** フォロー中の声優ごとにまとめやすいよう、どの声優で拾った作品かを添える */
export type FeedItem = WorkWithListings & {
  actors: Array<{ id: string; slug: string; name: string }>;
};

export type SitemapEntries = {
  actors: Array<{ slug: string; updatedAt: string }>;
  works: Array<{ id: string; updatedAt: string }>;
};

/** 作品ページ。listing と credit をすべて付ける */
export async function getWorkById(
  db: AppDb,
  id: string,
  now: string = new Date().toISOString(),
): Promise<WorkDetail | undefined> {
  // 一覧と同じく R18 は出さない。ここだけ絞っていないと、一覧に出ない作品でも
  // URL を直接叩けば見えてしまう (設計書 §14)
  const [row] = await db
    .select()
    .from(audioWorks)
    .where(and(eq(audioWorks.id, id), notAdultRated))
    .limit(1);
  if (!row) return undefined;

  const [listings, creditRows, baselines] = await Promise.all([
    loadListings(db, [id]),
    db
      .select({
        creditedName: audioCredits.creditedName,
        role: audioCredits.role,
        confidence: audioCredits.confidence,
        sourceStoreSlug: audioCredits.sourceStoreSlug,
        voiceActorId: audioCredits.voiceActorId,
        voiceActorSlug: voiceActors.slug,
        voiceActorName: voiceActors.canonicalName,
      })
      .from(audioCredits)
      .leftJoin(voiceActors, eq(voiceActors.id, audioCredits.voiceActorId))
      .where(eq(audioCredits.audioWorkId, id))
      .orderBy(asc(audioCredits.creditedName)),
    loadCrawlBaselines(db),
  ]);

  const workListings = listings.get(id) ?? [];
  const actorIds = creditRows
    .map((credit) => credit.voiceActorId)
    .filter((actorId): actorId is string => actorId !== null);

  return {
    work: toWorkSummary(row),
    listings: workListings,
    ...classifyWork(row.releaseDate, workListings, actorIds, baselines, now),
    credits: creditRows.map((credit) => ({
      creditedName: credit.creditedName,
      ...(credit.role ? { role: credit.role } : {}),
      confidence: credit.confidence,
      sourceStoreSlug: credit.sourceStoreSlug,
      ...(credit.voiceActorId ? { voiceActorId: credit.voiceActorId } : {}),
      ...(credit.voiceActorSlug ? { voiceActorSlug: credit.voiceActorSlug } : {}),
      ...(credit.voiceActorName ? { voiceActorName: credit.voiceActorName } : {}),
    })),
  };
}

/** 声優ページの作品一覧。発売日の新しい順、発売日不明は初出の新しい順で後ろに回す */
export async function worksByActor(
  db: AppDb,
  voiceActorId: string,
  options: { limit?: number; storeSlug?: StoreSlug; now?: string } = {},
): Promise<WorkWithListings[]> {
  const { limit = 50, storeSlug, now = new Date().toISOString() } = options;

  const rows = await db
    .select(workSelection)
    .from(audioWorks)
    .innerJoin(audioCredits, eq(audioCredits.audioWorkId, audioWorks.id))
    .innerJoin(storeListings, eq(storeListings.audioWorkId, audioWorks.id))
    .where(
      and(
        eq(audioCredits.voiceActorId, voiceActorId),
        notAdultRated,
        storeSlug ? eq(storeListings.storeSlug, storeSlug) : undefined,
      ),
    )
    .groupBy(audioWorks.id)
    .orderBy(...newestFirstOrder)
    .limit(limit);

  // この一覧はこの声優のページなので、発売日が無い作品のベースラインもこの声優のものだけ見る
  const [listings, baselines] = await Promise.all([
    loadListings(
      db,
      rows.map((row) => row.id),
    ),
    loadCrawlBaselines(db),
  ]);

  return rows.map((row) => {
    const workListings = listings.get(row.id) ?? [];
    return {
      work: toWorkSummary(row),
      listings: workListings,
      ...classifyWork(row.releaseDate, workListings, [voiceActorId], baselines, now),
    };
  });
}

/** 全声優横断の新着。フォローが 0 件のときのトップ画面で使う */
export async function latestWorks(
  db: AppDb,
  options: { limit?: number; sinceDays?: number; now?: string } = {},
): Promise<WorkWithListings[]> {
  const { limit = 50, sinceDays = FEED_WINDOW_DAYS, now = new Date().toISOString() } = options;

  const rows = await db
    .select(workSelection)
    .from(audioWorks)
    .innerJoin(storeListings, eq(storeListings.audioWorkId, audioWorks.id))
    .where(and(notAdultRated, withinPeriod(now, sinceDays)))
    .groupBy(audioWorks.id)
    .orderBy(...feedOrder)
    .limit(limit);

  const workIds = rows.map((row) => row.id);
  const [listings, actorIdsByWork, baselines] = await Promise.all([
    loadListings(db, workIds),
    loadCreditedActorIds(db, workIds),
    loadCrawlBaselines(db),
  ]);

  const classified = rows.map((row) => {
    const workListings = listings.get(row.id) ?? [];
    return {
      row,
      listings: workListings,
      ...classifyWork(
        row.releaseDate,
        workListings,
        actorIdsByWork.get(row.id) ?? [],
        baselines,
        now,
      ),
    };
  });

  return classified.sort(compareFeedOrder).map(toWorkWithListings);
}

/**
 * フォロー中の声優の新着フィード。
 *
 * フォロー状態はブラウザ内にしか無いので、画面が持っている声優 id の配列を丸ごと受け取る。
 * 数が多いと IN 句に入り切らないため分割して引き、JS 側で並べ直してから limit をかける
 */
export async function feedForActors(
  db: AppDb,
  voiceActorIds: string[],
  options: { limit?: number; sinceDays?: number; now?: string } = {},
): Promise<FeedItem[]> {
  const { limit = 50, sinceDays = FEED_WINDOW_DAYS, now = new Date().toISOString() } = options;
  if (voiceActorIds.length === 0) return [];

  const collected = new Map<string, WorkRow>();
  for (const ids of chunked(voiceActorIds)) {
    const rows = await db
      .select(workSelection)
      .from(audioWorks)
      .innerJoin(audioCredits, eq(audioCredits.audioWorkId, audioWorks.id))
      .innerJoin(storeListings, eq(storeListings.audioWorkId, audioWorks.id))
      .where(
        and(inArray(audioCredits.voiceActorId, ids), notAdultRated, withinPeriod(now, sinceDays)),
      )
      .groupBy(audioWorks.id)
      .orderBy(...feedOrder)
      .limit(limit);

    for (const row of rows) collected.set(row.id, row);
  }

  // 段 (freshness) は listing の初出とクロール履歴から決まるので、並べ替える前に全行ぶん引く。
  // limit で切るのは段を付けた後。チャンクが 1 回で済む間 (フォロー 90 人まで) は
  // 引く行数も limit のままで、それ以上フォローしたときだけ一時的に増える
  const rows = [...collected.values()];
  const workIds = rows.map((row) => row.id);
  const [listings, actorsByWork, baselines] = await Promise.all([
    loadListings(db, workIds),
    loadFeedActors(db, workIds, voiceActorIds),
    loadCrawlBaselines(db),
  ]);

  const classified = rows.map((row) => {
    const workListings = listings.get(row.id) ?? [];
    const actors = actorsByWork.get(row.id) ?? [];
    return {
      row,
      listings: workListings,
      actors,
      ...classifyWork(
        row.releaseDate,
        workListings,
        actors.map((actor) => actor.id),
        baselines,
        now,
      ),
    };
  });

  return classified
    .sort(compareFeedOrder)
    .slice(0, limit)
    .map((item) => ({ ...toWorkWithListings(item), actors: item.actors }));
}

/**
 * 指定ストアで既に DB に入っている商品 ID (`store_product_id`) の一覧。
 *
 * クローラーが DLsite の `product.json` を新規 ID だけに絞るために使う。DLsite は 1 作品ずつ
 * しか引けず間隔も要るので、既知の 30 件を毎回引き直すと 1 声優あたり 1 分近く無駄になる
 */
export async function knownStoreProductIds(db: AppDb, storeSlug: StoreSlug): Promise<string[]> {
  const rows = await db
    .select({ storeProductId: storeListings.storeProductId })
    .from(storeListings)
    .where(eq(storeListings.storeSlug, storeSlug))
    .orderBy(asc(storeListings.storeProductId));
  return rows.map((row) => row.storeProductId);
}

/** sitemap.xml が並べる URL の材料 (設計書 §6) */
export async function sitemapEntries(db: AppDb): Promise<SitemapEntries> {
  const [actorRows, workRows] = await Promise.all([
    db
      .select({ slug: voiceActors.slug, updatedAt: voiceActors.updatedAt })
      .from(voiceActors)
      // 作品が 1 件も無い声優のページは notFound() を返すので sitemap にも出さない (T13)
      .where(hasAnyAudioCredit)
      .orderBy(asc(voiceActors.slug)),
    db
      .select({ id: audioWorks.id, updatedAt: audioWorks.updatedAt })
      .from(audioWorks)
      .where(notAdultRated)
      .orderBy(desc(audioWorks.updatedAt)),
  ]);

  return { actors: actorRows, works: workRows };
}

// --- 内部 ----------------------------------------------------------------

/**
 * フィードに載せる範囲 (設計書 §10)。新着は発売日基準なので、発売日があるものは
 * 発売日だけで絞る (未来の発売日は常に入る)。発売日が無い作品 (Audible のポッドキャスト等) は
 * 判断材料が初出しか無いので、そこだけ初出で絞る。
 *
 * 「発売日は古いが最近見つかった」作品を拾わないのが以前との違い。声優を追加するたびに
 * 過去作が新着として流れ込むのを止めるため
 */
function withinPeriod(now: string, sinceDays: number) {
  const sinceIso = isoDaysAgo(now, sinceDays);
  return or(
    gte(audioWorks.releaseDate, sinceIso.slice(0, 10)),
    and(isNull(audioWorks.releaseDate), gte(storeListings.firstSeenAt, sinceIso)),
  );
}

/** 声優 × ストアごとの初回成功クロール。キーは `baselineKey()` */
type CrawlBaselines = Map<string, string>;

function baselineKey(voiceActorId: string, storeSlug: StoreSlug): string {
  return `${voiceActorId} ${storeSlug}`;
}

/**
 * 声優 × ストアごとの「初回成功クロールの開始時刻」(設計書 §10)。
 *
 * 発売日が無い作品を新着扱いしてよいのは、この時刻より後に見つかった分だけ。初回クロールは
 * 既存の全作品を一度に見つけるので、そこを起点にしないと声優を追加するたびに全作品が新着になる。
 * ingest は `crawl_runs.started_at` と `store_listings.first_seen_at` に同じ時刻を書くため、
 * 初回クロールで見つかった作品は「等しい」= 新着ではない、と判定できる。
 *
 * 行数は 声優数 × ストア数 (MVP では 35 × 2) なので、まとめて 1 回で読む
 */
async function loadCrawlBaselines(db: AppDb): Promise<CrawlBaselines> {
  const rows = await db
    .select({
      voiceActorId: crawlRuns.voiceActorId,
      storeSlug: crawlRuns.storeSlug,
      startedAt: sql<string>`min(${crawlRuns.startedAt})`,
    })
    .from(crawlRuns)
    .where(eq(crawlRuns.status, "ok"))
    .groupBy(crawlRuns.voiceActorId, crawlRuns.storeSlug);

  const baselines: CrawlBaselines = new Map();
  for (const row of rows)
    baselines.set(baselineKey(row.voiceActorId, row.storeSlug), row.startedAt);
  return baselines;
}

/** 作品ごとの、名寄せ済みクレジットの声優 id。発売日が無い作品のベースライン選びに使う */
async function loadCreditedActorIds(db: AppDb, workIds: string[]): Promise<Map<string, string[]>> {
  const byWork = new Map<string, string[]>();
  if (workIds.length === 0) return byWork;

  for (const ids of chunked(workIds)) {
    const rows = await db
      .select({ audioWorkId: audioCredits.audioWorkId, voiceActorId: audioCredits.voiceActorId })
      .from(audioCredits)
      .where(and(inArray(audioCredits.audioWorkId, ids), isNotNull(audioCredits.voiceActorId)));

    for (const row of rows) {
      if (!row.voiceActorId) continue;
      const list = byWork.get(row.audioWorkId);
      if (list) list.push(row.voiceActorId);
      else byWork.set(row.audioWorkId, [row.voiceActorId]);
    }
  }
  return byWork;
}

/**
 * 発売日が無い作品を「いつ見つけたか」。初回クロールより後に現れた listing だけを見る。
 * 該当が無ければ undefined = 初回クロールで既にあった (= 新着ではない)
 */
function discoveredAfterBaseline(
  listings: WorkListing[],
  actorIds: string[],
  baselines: CrawlBaselines,
): string | undefined {
  let earliest: string | undefined;
  for (const listing of listings) {
    for (const actorId of actorIds) {
      const baseline = baselines.get(baselineKey(actorId, listing.storeSlug));
      if (!baseline || listing.firstSeenAt <= baseline) continue;
      if (earliest === undefined || listing.firstSeenAt < earliest) earliest = listing.firstSeenAt;
    }
  }
  return earliest;
}

/**
 * 作品の段と NEW バッジ (設計書 §10)。
 *
 * 発売日があればそれだけで決める。未来なら upcoming、30 日以内なら recent、それより前は older。
 * 発売日が無い作品は初回クロール以降に見つかった場合だけ発見日時で判定する。
 * upcoming に NEW を付けないのは、まだ出ていないものを「新着」と読ませないため
 * (カードには代わりに「発売予定 M月D日」を出す)
 */
function classifyWork(
  releaseDate: string | null,
  listings: WorkListing[],
  actorIds: string[],
  baselines: CrawlBaselines,
  now: string,
): { freshness: Freshness; isNew: boolean } {
  const today = now.slice(0, 10);
  if (releaseDate) {
    if (releaseDate > today) return { freshness: "upcoming", isNew: false };
    if (releaseDate < shiftDate(today, -RECENT_DAYS)) return { freshness: "older", isNew: false };
    return { freshness: "recent", isNew: releaseDate >= shiftDate(today, -NEW_DAYS) };
  }

  const found = discoveredAfterBaseline(listings, actorIds, baselines);
  if (found === undefined || found < isoDaysAgo(now, RECENT_DAYS)) {
    return { freshness: "older", isNew: false };
  }
  return { freshness: "recent", isNew: found >= isoDaysAgo(now, NEW_DAYS) };
}

/** "2026-09-18" の days 日ぶん前後。Date に通しても UTC 固定なのでタイムゾーンでずれない */
function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function isoDaysAgo(now: string, days: number): string {
  return new Date(Date.parse(now) - days * DAY_MS).toISOString();
}

/** 作品に紐づく listing の初出のうち最も古いもの。発売日が無い作品の並び順に使う */
const firstSeenAtExpression = sql<string>`min(${storeListings.firstSeenAt})`;

const workSelection = {
  id: audioWorks.id,
  title: audioWorks.title,
  category: audioWorks.category,
  releaseDate: audioWorks.releaseDate,
  coverImageUrl: audioWorks.coverImageUrl,
  durationSeconds: audioWorks.durationSeconds,
  makerName: audioWorks.makerName,
  firstSeenAt: firstSeenAtExpression,
};

type WorkRow = {
  id: string;
  title: string;
  category: WorkCategory;
  releaseDate: string | null;
  coverImageUrl: string | null;
  durationSeconds: number | null;
  makerName: string | null;
  firstSeenAt: string;
};

/**
 * 発売日の降順。発売日が無い作品は末尾にまとめ、その中では初出の新しい順にする。
 * SQLite は NULL を最小値として扱うので DESC だけでも末尾に来るが、意図を残すため明示する
 */
const newestFirstOrder = [
  sql`case when ${audioWorks.releaseDate} is null then 1 else 0 end`,
  desc(audioWorks.releaseDate),
  desc(firstSeenAtExpression),
];

/**
 * フィードの並べ替えキー。発売日、無ければ初出の日付。
 *
 * 発売日が無い作品を末尾に回さないのは、フィードでは「30 日以内の新作」の段に
 * 入りうるため。limit で切る前に段の中の位置が決まっている必要がある
 */
const feedSortKey = sql<string>`
  coalesce(${audioWorks.releaseDate}, substr(${firstSeenAtExpression}, 1, 10))
`;

/** SQL 側は発売日の降順まで。段 (freshness) は JS で付け直す */
const feedOrder = [desc(feedSortKey)];

function rowSortKey(row: WorkRow): string {
  return row.releaseDate ?? row.firstSeenAt.slice(0, 10);
}

/** 段の順。upcoming → recent → older (設計書 §10) */
const TIER_RANK: Record<Freshness, number> = { upcoming: 0, recent: 1, older: 2 };

type ClassifiedRow = {
  row: WorkRow;
  listings: WorkListing[];
  freshness: Freshness;
  isNew: boolean;
};

/**
 * フィードの並び。段が先、段の中では upcoming だけ発売日の昇順 (近い予定から) で、
 * 残りは発売日の降順。同着は id で固定して結果が実行ごとに揺れないようにする
 */
function compareFeedOrder(a: ClassifiedRow, b: ClassifiedRow): number {
  const rank = TIER_RANK[a.freshness] - TIER_RANK[b.freshness];
  if (rank !== 0) return rank;

  const keyA = rowSortKey(a.row);
  const keyB = rowSortKey(b.row);
  if (keyA !== keyB) {
    if (a.freshness === "upcoming") return keyA < keyB ? -1 : 1;
    return keyA < keyB ? 1 : -1;
  }
  return a.row.id < b.row.id ? -1 : 1;
}

function toWorkWithListings(item: ClassifiedRow): WorkWithListings {
  return {
    work: toWorkSummary(item.row),
    listings: item.listings,
    freshness: item.freshness,
    isNew: item.isNew,
  };
}

async function loadListings(db: AppDb, workIds: string[]): Promise<Map<string, WorkListing[]>> {
  const byWork = new Map<string, WorkListing[]>();
  if (workIds.length === 0) return byWork;

  for (const ids of chunked(workIds)) {
    const rows = await db
      .select()
      .from(storeListings)
      .where(inArray(storeListings.audioWorkId, ids))
      .orderBy(asc(storeListings.storeSlug));

    for (const row of rows) {
      const listing: WorkListing = {
        storeSlug: row.storeSlug,
        storeProductId: row.storeProductId,
        productUrl: row.productUrl,
        ...(row.affiliateUrl ? { affiliateUrl: row.affiliateUrl } : {}),
        titleRaw: row.titleRaw,
        ...(row.price !== null ? { price: row.price } : {}),
        ...(row.listPrice !== null ? { listPrice: row.listPrice } : {}),
        available: row.available,
        firstSeenAt: row.firstSeenAt,
        lastSeenAt: row.lastSeenAt,
      };
      const list = byWork.get(row.audioWorkId);
      if (list) list.push(listing);
      else byWork.set(row.audioWorkId, [listing]);
    }
  }
  return byWork;
}

/** フィードの各作品に「フォロー中の誰で引っかかったか」を付ける */
async function loadFeedActors(
  db: AppDb,
  workIds: string[],
  voiceActorIds: string[],
): Promise<Map<string, Array<{ id: string; slug: string; name: string }>>> {
  const byWork = new Map<string, Array<{ id: string; slug: string; name: string }>>();
  if (workIds.length === 0) return byWork;

  const followed = new Set(voiceActorIds);
  for (const ids of chunked(workIds)) {
    const rows = await db
      .select({
        audioWorkId: audioCredits.audioWorkId,
        id: voiceActors.id,
        slug: voiceActors.slug,
        name: voiceActors.canonicalName,
      })
      .from(audioCredits)
      .innerJoin(voiceActors, eq(voiceActors.id, audioCredits.voiceActorId))
      .where(inArray(audioCredits.audioWorkId, ids))
      .orderBy(asc(voiceActors.canonicalName));

    for (const row of rows) {
      if (!followed.has(row.id)) continue;
      const entry = { id: row.id, slug: row.slug, name: row.name };
      const list = byWork.get(row.audioWorkId);
      if (list) list.push(entry);
      else byWork.set(row.audioWorkId, [entry]);
    }
  }
  return byWork;
}

function toWorkSummary(row: WorkRow | typeof audioWorks.$inferSelect): WorkSummary {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    ...(row.releaseDate ? { releaseDate: row.releaseDate } : {}),
    ...(row.coverImageUrl ? { coverImageUrl: row.coverImageUrl } : {}),
    ...(row.durationSeconds !== null ? { durationSeconds: row.durationSeconds } : {}),
    ...(row.makerName ? { makerName: row.makerName } : {}),
  };
}
