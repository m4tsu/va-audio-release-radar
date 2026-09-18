import { and, asc, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import type { CreditConfidence, StoreSlug, WorkCategory } from "@/domain/types";
import { chunked } from "../db/chunked";
import { audioCredits, audioWorks, storeListings, voiceActors } from "../db/schema";
import type { AppDb } from "../db/types";

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
export async function getWorkById(db: AppDb, id: string): Promise<WorkDetail | undefined> {
  // 一覧と同じく成人向けは出さない。ここだけ絞っていないと、一覧に出ない作品でも
  // URL を直接叩けば見えてしまう (設計書 §1「成人向け作品は導入しない」)
  const [row] = await db
    .select()
    .from(audioWorks)
    .where(and(eq(audioWorks.id, id), eq(audioWorks.adult, false)))
    .limit(1);
  if (!row) return undefined;

  const [listings, creditRows] = await Promise.all([
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
  ]);

  return {
    work: toWorkSummary(row),
    listings: listings.get(id) ?? [],
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
  options: { limit?: number; storeSlug?: StoreSlug } = {},
): Promise<WorkWithListings[]> {
  const { limit = 50, storeSlug } = options;

  const rows = await db
    .select(workSelection)
    .from(audioWorks)
    .innerJoin(audioCredits, eq(audioCredits.audioWorkId, audioWorks.id))
    .innerJoin(storeListings, eq(storeListings.audioWorkId, audioWorks.id))
    .where(
      and(
        eq(audioCredits.voiceActorId, voiceActorId),
        eq(audioWorks.adult, false),
        storeSlug ? eq(storeListings.storeSlug, storeSlug) : undefined,
      ),
    )
    .groupBy(audioWorks.id)
    .orderBy(...newestFirstOrder)
    .limit(limit);

  return attachListings(db, rows);
}

/** 全声優横断の新着。フォローが 0 件のときのトップ画面で使う */
export async function latestWorks(
  db: AppDb,
  options: { limit?: number; sinceDays?: number; now?: string } = {},
): Promise<WorkWithListings[]> {
  const { limit = 50, sinceDays = 30, now = new Date().toISOString() } = options;

  const rows = await db
    .select(workSelection)
    .from(audioWorks)
    .innerJoin(storeListings, eq(storeListings.audioWorkId, audioWorks.id))
    .where(and(eq(audioWorks.adult, false), withinPeriod(now, sinceDays)))
    .groupBy(audioWorks.id)
    .orderBy(...newestFirstOrder)
    .limit(limit);

  return attachListings(db, rows);
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
  const { limit = 50, sinceDays = 30, now = new Date().toISOString() } = options;
  if (voiceActorIds.length === 0) return [];

  const collected = new Map<string, WorkRow>();
  for (const ids of chunked(voiceActorIds)) {
    const rows = await db
      .select(workSelection)
      .from(audioWorks)
      .innerJoin(audioCredits, eq(audioCredits.audioWorkId, audioWorks.id))
      .innerJoin(storeListings, eq(storeListings.audioWorkId, audioWorks.id))
      .where(
        and(
          inArray(audioCredits.voiceActorId, ids),
          eq(audioWorks.adult, false),
          withinPeriod(now, sinceDays),
        ),
      )
      .groupBy(audioWorks.id)
      .orderBy(...newestFirstOrder)
      .limit(limit);

    for (const row of rows) collected.set(row.id, row);
  }

  const rows = [...collected.values()].sort(compareNewestFirst).slice(0, limit);
  const [withListings, actorsByWork] = await Promise.all([
    attachListings(db, rows),
    loadFeedActors(
      db,
      rows.map((row) => row.id),
      voiceActorIds,
    ),
  ]);

  return withListings.map((item) => ({
    ...item,
    actors: actorsByWork.get(item.work.id) ?? [],
  }));
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
      .orderBy(asc(voiceActors.slug)),
    db
      .select({ id: audioWorks.id, updatedAt: audioWorks.updatedAt })
      .from(audioWorks)
      .where(eq(audioWorks.adult, false))
      .orderBy(desc(audioWorks.updatedAt)),
  ]);

  return { actors: actorRows, works: workRows };
}

// --- 内部 ----------------------------------------------------------------

/**
 * 作品が「新着」かどうか。発売日が期間内、または listing の初出が期間内なら拾う。
 * DLsite の一覧には発売日が無い作品があるので、初出でも救えるようにしてある
 */
function withinPeriod(now: string, sinceDays: number) {
  const sinceMs = Date.parse(now) - sinceDays * 24 * 60 * 60 * 1000;
  const sinceIso = new Date(sinceMs).toISOString();
  return or(
    gte(audioWorks.releaseDate, sinceIso.slice(0, 10)),
    gte(storeListings.firstSeenAt, sinceIso),
  );
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

/** SQL の ORDER BY と同じ並びを JS 側でも再現する (チャンク分割した結果を並べ直すため) */
function compareNewestFirst(a: WorkRow, b: WorkRow): number {
  if (a.releaseDate !== b.releaseDate) {
    if (a.releaseDate === null) return 1;
    if (b.releaseDate === null) return -1;
    return a.releaseDate < b.releaseDate ? 1 : -1;
  }
  if (a.firstSeenAt === b.firstSeenAt) return 0;
  return a.firstSeenAt < b.firstSeenAt ? 1 : -1;
}

async function attachListings(db: AppDb, rows: WorkRow[]): Promise<WorkWithListings[]> {
  const listings = await loadListings(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    work: toWorkSummary(row),
    listings: listings.get(row.id) ?? [],
  }));
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
