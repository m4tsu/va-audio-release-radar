import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import type { CreditConfidence, StoreSlug, WorkCategory } from "@/domain/types";
import { chunked } from "../db/chunked";
import { audioCredits, audioWorks, crawlRuns, storeListings, voiceActors } from "../db/schema";
import type { AppDb } from "../db/types";
import { hasAnyAudioCredit } from "./actors";

/**
 * 発売日を基準にした「新しさ」。画面の 3 段と NEW バッジはこの値だけで決める。
 *
 * クライアントで再計算すると SSR とハイドレーション後で結果がずれる (時計が違う) ため、
 * 判定はサーバーに寄せて値として配る
 */
export type Freshness = "upcoming" | "recent" | "older";

/** フィードが遡る日数。3 段目「それ以前」の下限 */
export const FEED_WINDOW_DAYS = 90;
/** 2 段目「30 日以内の新作」の幅 */
export const RECENT_DAYS = 30;
/** NEW バッジを出す日数。「今週の新着」に合わせる */
export const NEW_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 画面に出してよい作品の年齢区分。R18 だけを除く形にしてあるのは、
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
  firstSeenAt: string;
  lastSeenAt: string;
};

export type WorkWithListings = {
  work: WorkSummary;
  listings: WorkListing[];
  freshness: Freshness;
  /** NEW バッジ。発売日が 7 日以内、または発売日が無く 7 日以内に新しく見つかった作品 */
  isNew: boolean;
  /**
   * 出演者の数。画面はこの数だけで出演形態 (単独 / 少人数 / 大人数) を決める
   * (`@/app/lib/appearance`)。クレジットが 1 件も取れていない作品は 0
   */
  castSize: number;
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

/** 作品に出ている声優のうち、名寄せ済みの 1 人。カードから声優ページへ行けるだけの情報を持つ */
export type WorkActor = { id: string; slug: string; name: string; nameEn?: string };

/**
 * 出ている声優を添えた作品。新着のカードは誰が出ているかを名前で出す。
 * フィードでは「フォロー中の誰で引っかかったか」に絞った分だけが入る
 */
export type WorkWithActors = WorkWithListings & { actors: WorkActor[] };

export type FeedItem = WorkWithActors;

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
  // URL を直接叩けば見えてしまう
  const [row] = await db
    .select()
    .from(audioWorks)
    .where(and(eq(audioWorks.id, id), notAdultRated))
    .limit(1);
  if (!row) return undefined;

  const [listings, creditRows, baselines, castSizes] = await Promise.all([
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
    loadCastSizes(db, [id]),
  ]);

  const workListings = listings.get(id) ?? [];
  const actorIds = creditRows
    .map((credit) => credit.voiceActorId)
    .filter((actorId): actorId is string => actorId !== null);

  return {
    work: toWorkSummary(row),
    listings: workListings,
    ...classifyWork(row.releaseDate, workListings, actorIds, baselines, now),
    castSize: castSizes.get(id) ?? 0,
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

  // この一覧はこの声優のページなので、発売日が無い作品のベースラインもこの声優のものだけ見る。
  // 出演者数は作品ごとに引かず、並べる作品ぶんをまとめて 1 回で数える
  const workIds = rows.map((row) => row.id);
  const [listings, baselines, castSizes] = await Promise.all([
    loadListings(db, workIds),
    loadCrawlBaselines(db),
    loadCastSizes(db, workIds),
  ]);

  return rows.map((row) => {
    const workListings = listings.get(row.id) ?? [];
    return {
      work: toWorkSummary(row),
      listings: workListings,
      ...classifyWork(row.releaseDate, workListings, [voiceActorId], baselines, now),
      castSize: castSizes.get(row.id) ?? 0,
    };
  });
}

/**
 * 全声優横断の新着。トップで使う。
 *
 * `storeSlug` を渡すとそのストアに掲載がある作品だけになる。絞ってもカードに出す掲載は
 * 全ストアぶん (`loadListings`) のまま。同じ作品が他のストアにもあることは隠さない
 */
export async function latestWorks(
  db: AppDb,
  options: { limit?: number; sinceDays?: number; storeSlug?: StoreSlug; now?: string } = {},
): Promise<WorkWithActors[]> {
  const {
    limit = 50,
    sinceDays = FEED_WINDOW_DAYS,
    storeSlug,
    now = new Date().toISOString(),
  } = options;

  const rows = await db
    .select(workSelection)
    .from(audioWorks)
    .innerJoin(storeListings, eq(storeListings.audioWorkId, audioWorks.id))
    .where(
      and(
        notAdultRated,
        withinPeriod(now, sinceDays),
        storeSlug ? eq(storeListings.storeSlug, storeSlug) : undefined,
      ),
    )
    .groupBy(audioWorks.id)
    .orderBy(...feedOrder)
    .limit(limit);

  const workIds = rows.map((row) => row.id);
  const [listings, actorsByWork, baselines, castSizes] = await Promise.all([
    loadListings(db, workIds),
    loadWorkActors(db, workIds),
    loadCrawlBaselines(db),
    loadCastSizes(db, workIds),
  ]);

  const classified = rows.map((row) => {
    const workListings = listings.get(row.id) ?? [];
    const actors = actorsByWork.get(row.id) ?? [];
    return {
      row,
      listings: workListings,
      actors,
      castSize: castSizes.get(row.id) ?? 0,
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
    .map((item) => ({ ...toWorkWithListings(item), actors: item.actors }));
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
  const [listings, actorsByWork, baselines, castSizes] = await Promise.all([
    loadListings(db, workIds),
    loadWorkActors(db, workIds, voiceActorIds),
    loadCrawlBaselines(db),
    loadCastSizes(db, workIds),
  ]);

  const classified = rows.map((row) => {
    const workListings = listings.get(row.id) ?? [];
    const actors = actorsByWork.get(row.id) ?? [];
    return {
      row,
      listings: workListings,
      actors,
      castSize: castSizes.get(row.id) ?? 0,
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

/** sitemap.xml が並べる URL の材料 */
export async function sitemapEntries(db: AppDb): Promise<SitemapEntries> {
  const [actorRows, workRows] = await Promise.all([
    db
      .select({ slug: voiceActors.slug, updatedAt: voiceActors.updatedAt })
      .from(voiceActors)
      // 作品が 1 件も無い声優のページは noindex なので sitemap にも出さない
      // (条件は `routes/voice-actors.$slug.tsx` と揃える)
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
 * フィードに載せる範囲。新着は発売日基準なので、発売日があるものは
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
export type CrawlBaselines = Map<string, string>;

function baselineKey(voiceActorId: string, storeSlug: StoreSlug): string {
  return `${voiceActorId} ${storeSlug}`;
}

/**
 * 声優 × ストアごとの「初回成功クロールを取り込んだ時刻」。
 *
 * 発売日が無い作品を新着扱いしてよいのは、この時刻より後に見つかった分だけ。初回クロールは
 * 既存の全作品を一度に見つけるので、そこを起点にしないと声優を追加するたびに全作品が新着になる。
 * 見るのが `finished_at` なのは、ingest がそこと `store_listings.first_seen_at` に同じ時刻を書くため。
 * 初回クロールで見つかった作品は「等しい」= 新着ではない、と判定できる
 * (`started_at` はクローラーが取得を始めた時刻で、取り込みより前になる)。
 *
 * 声優に紐付かない走行 (新着一覧) は基準にならないので外す。
 * 行数は 声優数 × ストア数 なので、まとめて 1 回で読む
 */
export async function loadCrawlBaselines(db: AppDb): Promise<CrawlBaselines> {
  const rows = await db
    .select({
      voiceActorId: crawlRuns.voiceActorId,
      storeSlug: crawlRuns.storeSlug,
      finishedAt: sql<string>`min(${crawlRuns.finishedAt})`,
    })
    .from(crawlRuns)
    .where(
      and(
        eq(crawlRuns.status, "ok"),
        isNotNull(crawlRuns.voiceActorId),
        isNotNull(crawlRuns.finishedAt),
      ),
    )
    .groupBy(crawlRuns.voiceActorId, crawlRuns.storeSlug);

  const baselines: CrawlBaselines = new Map();
  for (const row of rows) {
    if (row.voiceActorId === null) continue;
    baselines.set(baselineKey(row.voiceActorId, row.storeSlug), row.finishedAt);
  }
  return baselines;
}

/**
 * 発売日が無い作品を「いつ見つけたか」。初回クロールより後に現れた listing だけを見る。
 * 該当が無ければ undefined = 初回クロールで既にあった (= 新着ではない)
 */
export function discoveredAfterBaseline(
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
 * 作品の段と NEW バッジ。
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

/** 段の順。upcoming → recent → older */
const TIER_RANK: Record<Freshness, number> = { upcoming: 0, recent: 1, older: 2 };

type ClassifiedRow = {
  row: WorkRow;
  listings: WorkListing[];
  freshness: Freshness;
  isNew: boolean;
  castSize: number;
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
    castSize: item.castSize,
  };
}

export async function loadListings(
  db: AppDb,
  workIds: string[],
): Promise<Map<string, WorkListing[]>> {
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

/**
 * 作品ごとの出演者数。画面はこの数だけで出演形態を決める (`@/app/lib/appearance`)。
 *
 * 数え方は画面の重複排除 (`@/app/lib/dedupe-credits`) と同じにする。`audio_credits` は
 * (作品, 表記, ストア) で一意なので、同じ人が 2 ストアに載っていれば行が 2 つできる。
 * 名寄せ済みは声優 ID、未解決の表記はその表記そのものを「誰か」とみなして数える。
 * 前置きを付けて数えるのは、声優 ID と表記が同じ文字列でも別物として扱うため。
 *
 * 作品 1 件ごとに引くと一覧で作品数ぶんのクエリになるので、まとめて数える
 */
async function loadCastSizes(db: AppDb, workIds: string[]): Promise<Map<string, number>> {
  const byWork = new Map<string, number>();
  if (workIds.length === 0) return byWork;

  for (const ids of chunked(workIds)) {
    const rows = await db
      .select({
        audioWorkId: audioCredits.audioWorkId,
        castSize: sql<number>`count(distinct coalesce(
          'actor:' || ${audioCredits.voiceActorId},
          'name:' || ${audioCredits.creditedName}
        ))`,
      })
      .from(audioCredits)
      .where(inArray(audioCredits.audioWorkId, ids))
      .groupBy(audioCredits.audioWorkId);

    for (const row of rows) byWork.set(row.audioWorkId, row.castSize);
  }
  return byWork;
}

/**
 * 作品ごとの、名寄せ済みクレジットの声優。名前順で、ストアの表記のまま残っている
 * 未解決のクレジットは入らない (voice_actors と結合できないため)。
 * 発売日が無い作品のベースライン選びと、カードに出す名前の両方がこの結果を使う。
 *
 * `onlyActorIds` を渡すとその中の声優だけになる。フィードが「フォロー中の誰で引っかかったか」
 * を出すのに使う。表記違いで同じ声優に解決された credit が複数あると同じ声優が複数回入るので、
 * 名前として出す側で重複を除く (`dedupeCredits`)
 */
async function loadWorkActors(
  db: AppDb,
  workIds: string[],
  onlyActorIds?: string[],
): Promise<Map<string, WorkActor[]>> {
  const byWork = new Map<string, WorkActor[]>();
  if (workIds.length === 0) return byWork;

  const allowed = onlyActorIds ? new Set(onlyActorIds) : undefined;
  for (const ids of chunked(workIds)) {
    const rows = await db
      .select({
        audioWorkId: audioCredits.audioWorkId,
        id: voiceActors.id,
        slug: voiceActors.slug,
        name: voiceActors.canonicalName,
        nameEn: voiceActors.nameEn,
      })
      .from(audioCredits)
      .innerJoin(voiceActors, eq(voiceActors.id, audioCredits.voiceActorId))
      .where(inArray(audioCredits.audioWorkId, ids))
      .orderBy(asc(voiceActors.canonicalName));

    for (const row of rows) {
      if (allowed && !allowed.has(row.id)) continue;
      const actor: WorkActor = {
        id: row.id,
        slug: row.slug,
        name: row.name,
        ...(row.nameEn ? { nameEn: row.nameEn } : {}),
      };
      const list = byWork.get(row.audioWorkId);
      if (list) list.push(actor);
      else byWork.set(row.audioWorkId, [actor]);
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
