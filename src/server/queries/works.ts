import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import {
  type CreditConfidence,
  STORE_SLUGS,
  type StoreSlug,
  type WorkCategory,
} from "@/domain/types";
import { chunked, SQL_IN_CHUNK_SIZE } from "../db/chunked";
import { audioCredits, audioWorks, crawlRuns, storeListings, voiceActors } from "../db/schema";
import type { AppDb } from "../db/types";
import { hasOnSaleAudioWork } from "./actors";

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

/**
 * どこかのストアでまだ買える作品か。
 *
 * ストアが販売終了を示した listing には `delisted_at` が入る
 * (`docs/decisions/0008-no-price-no-availability.md`)。作品の行は消さないので、読むときに落とす。
 * 1 つのストアで終わっても他で買えるなら出す。listing を 1 件も持たない作品は出さない
 */
export const onSaleSomewhere: SQL = sql`exists (
  select 1 from ${storeListings}
  where ${storeListings.audioWorkId} = ${audioWorks.id}
    and ${storeListings.delistedAt} is null
)`;

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

/**
 * 1 人の声優の実績。フォローを押す前に「何件出していて、いちばん新しいのはいつか」を
 * 見せるために出す。作品が 1 件も無い声優は行が返らない
 */
export type ActorWorkStats = {
  voiceActorId: string;
  workCount: number;
  /**
   * いちばん新しい発売日 ("YYYY-MM-DD")。発売日を持たない作品は初出の日付で代える。
   * 発売予定 (未来の発売日) の作品もここに出る。一覧の先頭に来る作品と同じ日付にするため、
   * 今日で切らない
   */
  latestReleaseDate?: string;
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
  // URL を直接叩けば見えてしまう
  const [row] = await db
    .select()
    .from(audioWorks)
    .where(and(eq(audioWorks.id, id), notAdultRated, onSaleSomewhere))
    .limit(1);
  if (!row) return undefined;

  const [listings, creditRows, castSizes] = await Promise.all([
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
    loadCastSizes(db, [id]),
  ]);

  const workListings = listings.get(id) ?? [];
  const actorIds = creditRows
    .map((credit) => credit.voiceActorId)
    .filter((actorId): actorId is string => actorId !== null);
  const baselines = await loadCrawlBaselines(db, actorIds);

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

/**
 * 声優ページの作品一覧。ストアで分けず、発売日の新しい順に 1 本で返す。
 * 発売日を持たない作品は初出の日付を発売日の代わりに使い、同じ並びに入れる
 */
export async function worksByActor(
  db: AppDb,
  voiceActorId: string,
  options: { limit?: number; now?: string } = {},
): Promise<WorkWithListings[]> {
  const { limit = 50, now = new Date().toISOString() } = options;

  const rows = await db
    .select(workSelection)
    .from(audioWorks)
    .innerJoin(audioCredits, eq(audioCredits.audioWorkId, audioWorks.id))
    .innerJoin(storeListings, eq(storeListings.audioWorkId, audioWorks.id))
    .where(and(eq(audioCredits.voiceActorId, voiceActorId), notAdultRated, onSaleSomewhere))
    .groupBy(audioWorks.id)
    .orderBy(...newestFirstOrder)
    .limit(limit);

  // この一覧はこの声優のページなので、発売日が無い作品のベースラインもこの声優のものだけ見る。
  // 出演者数は作品ごとに引かず、並べる作品ぶんをまとめて 1 回で数える
  const workIds = rows.map((row) => row.id);
  const [listings, baselines, castSizes] = await Promise.all([
    loadListings(db, workIds),
    loadCrawlBaselines(db, [voiceActorId]),
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
 * 声優ごとの作品数と最新リリース。声優ページの見出しの下と、フォロー中の一覧が出す。
 *
 * 一覧に並べる作品は上限で切るので、件数はここで数え直す。切った先にある作品も数に入る。
 * 作品を 1 件も持たない声優は行が返らない (呼び出し側が 0 件として扱う)。
 *
 * 作品ごとの日付を決めてから声優ごとにまとめるのは、listing を複数持つ作品で
 * 「最初に見つけた日」が最も遅い listing の日付になるのを避けるため。
 * 一覧の並べ替えキー (`releaseSortKey`) と同じ値になっていないと、
 * 見出しの最新リリースと一覧の先頭が食い違う
 */
export async function workStatsForActors(
  db: AppDb,
  voiceActorIds: string[],
): Promise<ActorWorkStats[]> {
  if (voiceActorIds.length === 0) return [];

  const stats: ActorWorkStats[] = [];
  for (const ids of chunked(voiceActorIds)) {
    const perWork = db
      .select({
        voiceActorId: audioCredits.voiceActorId,
        releaseKey: releaseSortKey.as("release_key"),
      })
      .from(audioCredits)
      .innerJoin(audioWorks, eq(audioWorks.id, audioCredits.audioWorkId))
      .innerJoin(storeListings, eq(storeListings.audioWorkId, audioWorks.id))
      .where(and(inArray(audioCredits.voiceActorId, ids), notAdultRated, onSaleSomewhere))
      .groupBy(audioCredits.voiceActorId, audioWorks.id)
      .as("per_work");

    const rows = await db
      .select({
        voiceActorId: perWork.voiceActorId,
        workCount: sql<number>`count(*)`,
        latestReleaseDate: sql<string | null>`max(${perWork.releaseKey})`,
      })
      .from(perWork)
      .groupBy(perWork.voiceActorId);

    for (const row of rows) {
      if (row.voiceActorId === null) continue;
      stats.push({
        voiceActorId: row.voiceActorId,
        workCount: Number(row.workCount ?? 0),
        ...(row.latestReleaseDate ? { latestReleaseDate: row.latestReleaseDate } : {}),
      });
    }
  }
  return stats;
}

/**
 * 全声優横断の新着。トップで使う。
 *
 * `storeSlug` を渡すとそのストアに掲載がある作品だけになる。絞ってもカードに出す掲載は
 * 全ストアぶん (`loadListings`) のまま。同じ作品が他のストアにもあることは隠さない。
 *
 * 発売日のある作品と無い作品を別々に引いてから合わせる。1 本の問い合わせだと窓の条件が
 * 発売日と初出の `or` になり、索引を使えずに全作品と全 listing を読む。
 * それぞれの上位 `limit` 件を合わせて並べ直せば、全体の上位 `limit` 件と同じになる
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

  const sinceIso = isoDaysAgo(now, sinceDays);
  // 買える listing だけを見る。`storeSlug` で絞るときに取り下げた listing へ当たると、
  // 他のストアで買えることを根拠に「そのストアで買える作品」として出てしまう
  const listingOnSale = and(
    isNull(storeListings.delistedAt),
    storeSlug ? eq(storeListings.storeSlug, storeSlug) : undefined,
  );

  const [dated, undated] = await Promise.all([
    // 発売日の索引を新しい順にたどり、`limit` 件そろった所で止まる。集約すると止まれないので、
    // 初出は作品ごとの副問い合わせで取る (並べる件数ぶんしか評価されない)
    db
      .select({
        ...workColumns,
        firstSeenAt: sql<string>`(
          select min(${storeListings.firstSeenAt}) from ${storeListings}
          where ${storeListings.audioWorkId} = ${audioWorks.id} and ${listingOnSale}
        )`,
      })
      .from(audioWorks)
      .where(
        and(
          gte(audioWorks.releaseDate, sinceIso.slice(0, 10)),
          notAdultRated,
          sql`exists (
            select 1 from ${storeListings}
            where ${storeListings.audioWorkId} = ${audioWorks.id} and ${listingOnSale}
          )`,
        ),
      )
      .orderBy(desc(audioWorks.releaseDate), asc(audioWorks.id))
      .limit(limit),
    // 初出の索引で窓の中の listing だけを読む。発売日の条件の前の `+` は、発売日の索引
    // (発売日が無い作品を全部たどる) を選ばせないため
    db
      .select(workSelection)
      .from(storeListings)
      .innerJoin(audioWorks, eq(audioWorks.id, storeListings.audioWorkId))
      .where(
        and(
          gte(storeListings.firstSeenAt, sinceIso),
          listingOnSale,
          sql`+${audioWorks.releaseDate} is null`,
          notAdultRated,
        ),
      )
      .groupBy(audioWorks.id)
      .orderBy(...newestFirstOrder)
      .limit(limit),
  ]);
  // 同着を id で決めるのは、2 つを合わせたときにどちらの上位から採るかを実行ごとに揺らさないため
  const rows = [...dated, ...undated].sort(newestFirst).slice(0, limit);

  const workIds = rows.map((row) => row.id);
  const [listings, actorsByWork, castSizes] = await Promise.all([
    loadListings(db, workIds),
    loadWorkActors(db, workIds),
    loadCastSizes(db, workIds),
  ]);
  const baselines = await loadCrawlBaselines(db, actorIdsOf(actorsByWork));

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
      // 買える listing だけを繋ぐ。繋がらない作品はここで落ちる (`onSaleSomewhere` と同じ)
      .innerJoin(
        storeListings,
        and(eq(storeListings.audioWorkId, audioWorks.id), isNull(storeListings.delistedAt)),
      )
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
  const [listings, actorsByWork, castSizes] = await Promise.all([
    loadListings(db, workIds),
    loadWorkActors(db, workIds, voiceActorIds),
    loadCastSizes(db, workIds),
  ]);
  const baselines = await loadCrawlBaselines(db, actorIdsOf(actorsByWork));

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
 * 2 つの使い道がある。1 つは新規 ID の絞り込み。DLsite は 1 作品ずつしか引けず間隔も要るので、
 * 既知の 30 件を毎回引き直すと 1 声優あたり 1 分近く無駄になる。
 * もう 1 つは月次の取り下げの対象 (`crawler/delist.ts`)。取り下げ済みの行も返す。
 * 返さないと、また買えるようになった作品を引き直せなくなる
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
      // 買える作品が 1 件も無い声優のページは noindex なので sitemap にも出さない
      // (条件は `routes/voice-actors.$slug.tsx` と揃える)
      .where(hasOnSaleAudioWork)
      .orderBy(asc(voiceActors.slug)),
    db
      .select({ id: audioWorks.id, updatedAt: audioWorks.updatedAt })
      .from(audioWorks)
      .where(and(notAdultRated, onSaleSomewhere))
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
 *
 * `voiceActorIds` を渡すと、その声優の分だけを読む。画面は並べる作品の出演者の分しか使わないので、
 * 全声優ぶんを集計すると走行の記録が増えるほど 1 回の表示で読む行が増えていく。
 * 省くと全声優ぶんをまとめて 1 回で読む (ダイジェストが 1 回の起動で使い回す)
 */
export async function loadCrawlBaselines(
  db: AppDb,
  voiceActorIds?: readonly string[],
): Promise<CrawlBaselines> {
  const baselines: CrawlBaselines = new Map();
  const succeeded = and(
    eq(crawlRuns.status, "ok"),
    isNotNull(crawlRuns.voiceActorId),
    isNotNull(crawlRuns.finishedAt),
  );
  const scopes =
    voiceActorIds === undefined
      ? [succeeded]
      : // ストアも並べるのは `crawl_runs_store_actor_started_idx` (ストア, 声優) の索引で引くため。
        // 声優だけで絞ると先頭の列が決まらず、索引を使えずに全行を読む
        chunked(voiceActorIds, SQL_IN_CHUNK_SIZE - STORE_SLUGS.length).map((ids) =>
          and(
            succeeded,
            inArray(crawlRuns.storeSlug, [...STORE_SLUGS]),
            inArray(crawlRuns.voiceActorId, ids),
          ),
        );

  for (const where of scopes) {
    const rows = await db
      .select({
        voiceActorId: crawlRuns.voiceActorId,
        storeSlug: crawlRuns.storeSlug,
        finishedAt: sql<string>`min(${crawlRuns.finishedAt})`,
      })
      .from(crawlRuns)
      .where(where)
      .groupBy(crawlRuns.voiceActorId, crawlRuns.storeSlug);

    for (const row of rows) {
      if (row.voiceActorId === null) continue;
      baselines.set(baselineKey(row.voiceActorId, row.storeSlug), row.finishedAt);
    }
  }
  return baselines;
}

/** 作品ごとの出演者から、段を決めるのに要る声優の ID を集める */
function actorIdsOf(actorsByWork: Map<string, WorkActor[]>): string[] {
  const ids = new Set<string>();
  for (const actors of actorsByWork.values()) {
    for (const actor of actors) ids.add(actor.id);
  }
  return [...ids];
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

const workColumns = {
  id: audioWorks.id,
  title: audioWorks.title,
  category: audioWorks.category,
  releaseDate: audioWorks.releaseDate,
  coverImageUrl: audioWorks.coverImageUrl,
  durationSeconds: audioWorks.durationSeconds,
  makerName: audioWorks.makerName,
};

/** listing を繋いで作品ごとに集約する問い合わせの select。初出は繋いだ listing の最小 */
const workSelection = { ...workColumns, firstSeenAt: firstSeenAtExpression };

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
 * 並べ替えキー。発売日、無ければ初出の日付。
 *
 * 発売日が無い作品を末尾に回さないのは、フィードでは「30 日以内の新作」の段に
 * 入りうるため。limit で切る前に段の中の位置が決まっている必要がある。
 * 声優ページも同じキーで並べる。ストアで区画を分けないので、
 * 発売日を持たない作品 (Audible とポケドラに多い) を末尾に回すと、
 * そのストアの作品だけがまとまって最後に落ちる
 */
const releaseSortKey = sql<string>`
  coalesce(${audioWorks.releaseDate}, substr(${firstSeenAtExpression}, 1, 10))
`;

/**
 * 声優ページの並び。日付の降順で、同着は作品 ID で固定する。
 * limit で切る位置が実行ごとに動くと、切り落とされる作品が読み込みのたびに入れ替わる
 */
const newestFirstOrder = [desc(releaseSortKey), asc(audioWorks.id)];

/** SQL 側は発売日の降順まで。段 (freshness) は JS で付け直す */
const feedOrder = [desc(releaseSortKey)];

function rowSortKey(row: WorkRow): string {
  return row.releaseDate ?? row.firstSeenAt.slice(0, 10);
}

/** `newestFirstOrder` と同じ並び (日付の降順、同着は id の昇順) を JS 側で作る */
function newestFirst(a: WorkRow, b: WorkRow): number {
  const keyA = rowSortKey(a);
  const keyB = rowSortKey(b);
  if (keyA !== keyB) return keyA < keyB ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
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
      // 取り下げた listing は返さない。押すと買えない商品ページに飛ぶため
      .where(and(inArray(storeListings.audioWorkId, ids), isNull(storeListings.delistedAt)))
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
