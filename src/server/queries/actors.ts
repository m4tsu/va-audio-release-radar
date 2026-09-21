import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  like,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { normalizeName } from "@/domain/normalize";
import {
  STORE_SLUGS,
  type StoreSlug,
  VOICE_ACTOR_GENDERS,
  type VoiceActor,
  type VoiceActorAlias,
} from "@/domain/types";
import { chunked } from "../db/chunked";
import { stripLikeWildcards } from "../db/like";
import {
  animeAppearances,
  audioCredits,
  crawlRuns,
  storeListings,
  voiceActorAliases,
  voiceActors,
} from "../db/schema";
import type { AppDb } from "../db/types";
import { clearScreened } from "./screened";

/** 一覧・検索結果の 1 行。作品数は声優ページへ行く前の目安として画面に出す */
export type ActorSummary = {
  id: string;
  slug: string;
  canonicalName: string;
  nameKana?: string;
  /** 英語表示のときだけ使う表記。画面側の actorDisplayName が見る */
  nameEn?: string;
  imageUrl?: string;
  status: VoiceActor["status"];
  /** 一覧の絞り込みだけが見る。画面には文字として出さない (`pages/voice-actor-directory`) */
  gender: VoiceActor["gender"];
  workCount: number;
  /** この声優の作品が載っているストア。`STORE_SLUGS` の順。一覧のストア絞り込みが見る */
  storeSlugs: StoreSlug[];
};

export type ActorDetail = VoiceActor & { aliases: VoiceActorAlias[] };

const aliasSourceSchema = z.enum(["manual", "anilist", "store"]);

/** `POST /api/admin/actors` が受け取るシードの 1 件 */
export const actorSeedSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  canonicalName: z.string().min(1),
  nameKana: z.string().optional(),
  nameEn: z.string().optional(),
  anilistStaffId: z.number().int().optional(),
  imageUrl: z.string().optional(),
  status: z.enum(["active", "inactive", "unknown"]).default("unknown"),
  // 既定を置くのは、性別を送らない既存のシードがそのまま通るようにするため
  gender: z.enum(VOICE_ACTOR_GENDERS).default("unknown"),
  aliases: z
    .array(
      z.object({
        name: z.string().min(1),
        source: aliasSourceSchema,
        verified: z.boolean().default(false),
      }),
    )
    .optional(),
});

export type ActorSeed = z.infer<typeof actorSeedSchema>;

/**
 * シードからの投入。slug / id は入力をそのまま使う (URL に出るので自動採番にしない)。
 * 既に居る声優は上書きし、`created_at` だけは初回の値を残す
 */
export async function upsertActors(
  db: AppDb,
  actors: ActorSeed[],
  now: string = new Date().toISOString(),
): Promise<{ actors: number; aliases: number; clearedScreened: number }> {
  let aliasCount = 0;
  // 「対象声優が居ない」の判断は辞書に対するもの。増えたかどうかを入れる前に数える
  const before = await dictionarySize(db);

  for (const actor of actors) {
    await db
      .insert(voiceActors)
      .values({
        id: actor.id,
        slug: actor.slug,
        canonicalName: actor.canonicalName,
        nameKana: actor.nameKana ?? null,
        nameEn: actor.nameEn ?? null,
        anilistStaffId: actor.anilistStaffId ?? null,
        imageUrl: actor.imageUrl ?? null,
        status: actor.status,
        gender: actor.gender,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: voiceActors.id,
        set: {
          slug: actor.slug,
          canonicalName: actor.canonicalName,
          nameKana: actor.nameKana ?? null,
          nameEn: actor.nameEn ?? null,
          anilistStaffId: actor.anilistStaffId ?? null,
          imageUrl: actor.imageUrl ?? null,
          status: actor.status,
          gender: actor.gender,
          updatedAt: now,
        },
      });

    for (const alias of actor.aliases ?? []) {
      await db
        .insert(voiceActorAliases)
        .values({
          voiceActorId: actor.id,
          name: alias.name,
          source: alias.source,
          verified: alias.verified,
        })
        .onConflictDoUpdate({
          target: [voiceActorAliases.voiceActorId, voiceActorAliases.name],
          set: { source: alias.source, verified: alias.verified },
        });
      aliasCount += 1;
    }
  }

  // 声優か別名が増えたら、過去の「対象外」の判断を捨てる。
  // 捨てないと、新しく追い始めた声優の既存作品が新着一覧から永久に入らない
  const after = await dictionarySize(db);
  const clearedScreened = after > before ? await clearScreened(db) : 0;

  return { actors: actors.length, aliases: aliasCount, clearedScreened };
}

/** 名寄せに使う辞書の行数。声優と別名の合計 */
async function dictionarySize(db: AppDb): Promise<number> {
  const [actors] = await db.select({ count: count() }).from(voiceActors);
  const [aliases] = await db.select({ count: count() }).from(voiceActorAliases);
  return (actors?.count ?? 0) + (aliases?.count ?? 0);
}

/**
 * 声優一覧 (作品数付き、canonical_name 順)。
 *
 * 作品が 1 件も無い声優も返す。その人の「初めての 1 本」を待つためにフォローする経路が要る。
 * 既定の並び (作品数の多い順) では作品のある声優の後ろに来る (`lib/actor-directory`)
 */
export async function listActors(db: AppDb): Promise<ActorSummary[]> {
  const rows = await summaryQuery(db).orderBy(asc(voiceActors.canonicalName));
  return rows.map(toActorSummary);
}

/** 声優ページ用。エイリアスも一緒に返す */
export async function getActorBySlug(db: AppDb, slug: string): Promise<ActorDetail | undefined> {
  const [actor] = await db.select().from(voiceActors).where(eq(voiceActors.slug, slug)).limit(1);
  if (!actor) return undefined;

  const aliases = await db
    .select()
    .from(voiceActorAliases)
    .where(eq(voiceActorAliases.voiceActorId, actor.id))
    .orderBy(asc(voiceActorAliases.name));

  return {
    ...toVoiceActor(actor),
    aliases: aliases.map((alias) => ({
      voiceActorId: alias.voiceActorId,
      name: alias.name,
      source: alias.source,
      verified: alias.verified,
    })),
  };
}

/**
 * この声優について、そのストアの作品を取り切れているか。
 *
 * 取り切れていないストアでは、このサイトに載っているのは取得できた範囲だけになる
 * (`docs/decisions/0010-back-catalog-is-what-was-fetched.md`)。画面はこれを見て
 * ストアの検索へ送る導線を出す
 */
export type ActorStoreCoverage = { storeSlug: StoreSlug; complete: boolean };

/**
 * ストアごとに、真偽を記録した直近の走行から取り切れたかどうかを引く。
 *
 * `coverage_complete` が NULL の走行は飛ばして、その手前の走行を見る。取得に失敗した走行も
 * 行を残す (`crawler/run.ts` の失敗報告) ので、直近の 1 行だけを見ると失敗のたびに
 * 「取り切れていない」が消え、取得できた範囲だけのページが全作品のように見えてしまう。
 * 一度も真偽を記録していないストアは返さない。分からないものを取り切れていない側に寄せると、
 * 一度も引いていないストアにまで注記が出る。
 *
 * ストアは 3 つで固定なので 1 ストアずつ引く (`crawl_runs_store_actor_started_idx` が効く)
 */
export async function getActorStoreCoverage(
  db: AppDb,
  voiceActorId: string,
): Promise<ActorStoreCoverage[]> {
  const perStore = await Promise.all(
    STORE_SLUGS.map(async (storeSlug) => {
      const [run] = await db
        .select({ complete: crawlRuns.coverageComplete })
        .from(crawlRuns)
        .where(
          and(
            eq(crawlRuns.voiceActorId, voiceActorId),
            eq(crawlRuns.storeSlug, storeSlug),
            isNotNull(crawlRuns.coverageComplete),
          ),
        )
        // 並べるのは取得を始めた時刻。`finished_at` は NULL を許すので単独の基準にできない
        .orderBy(desc(crawlRuns.startedAt))
        .limit(1);
      return run === undefined || run.complete === null
        ? undefined
        : { storeSlug, complete: run.complete };
    }),
  );

  return perStore.filter((entry): entry is ActorStoreCoverage => entry !== undefined);
}

/**
 * 声優検索。部分一致 (SQL の LIKE) と表記揺れ一致 (`normalizeName`) の和集合を返す。
 *
 * `normalizeName` は空白・中黒などを落とすので SQL では表現できない。名前だけを全件読んで
 * JS 側で突き合わせている (`matchByNormalizedName`)。追跡対象が 2,500 人規模になり
 * 1 回の検索で声優と別名を全件読むようになったので、遅くなったら正規化済みの列を持たせて
 * 索引を張る。作品が 1 件も無い声優も結果に含める (`listActors` と同じ理由)
 */
export async function searchActors(db: AppDb, q: string, limit = 20): Promise<ActorSummary[]> {
  const query = q.trim();
  if (query.length === 0) return [];

  const ids = new Set<string>();

  // ワイルドカードを落とした結果が空なら LIKE は打たない ("%" だけの検索語が全件一致になるため)
  const literal = stripLikeWildcards(query);
  if (literal.length > 0) {
    const pattern = `%${literal}%`;
    const likeRows = await db
      .selectDistinct({ id: voiceActors.id })
      .from(voiceActors)
      .leftJoin(voiceActorAliases, eq(voiceActorAliases.voiceActorId, voiceActors.id))
      .where(
        or(
          like(voiceActors.canonicalName, pattern),
          like(voiceActors.nameKana, pattern),
          like(voiceActorAliases.name, pattern),
        ),
      );
    for (const row of likeRows) ids.add(row.id);
  }

  for (const id of await matchByNormalizedName(db, query)) {
    ids.add(id);
  }
  if (ids.size === 0) return [];

  // LIKE と正規化一致の和集合は声優数ぶんまで膨らむ。D1 の bound parameter 上限に
  // 当たらないよう IN 句を分割し、並べ替えと limit は全チャンクを集めてから JS 側でかける
  const collected = new Map<string, ActorSummaryRow>();
  for (const chunk of chunked([...ids])) {
    const rows = await summaryQuery(db, inArray(voiceActors.id, chunk));
    for (const row of rows) collected.set(row.id, row);
  }

  return [...collected.values()]
    .sort((a, b) => a.canonicalName.localeCompare(b.canonicalName, "ja"))
    .slice(0, limit)
    .map(toActorSummary);
}

/** ingest と管理画面の候補提示で共有する。名寄せに要る材料をまとめて読む */
export async function loadActorIndex(
  db: AppDb,
): Promise<{ actors: VoiceActor[]; aliases: VoiceActorAlias[] }> {
  const [actorRows, aliasRows] = await Promise.all([
    db.select().from(voiceActors),
    db.select().from(voiceActorAliases),
  ]);

  return {
    actors: actorRows.map(toVoiceActor),
    aliases: aliasRows.map((alias) => ({
      voiceActorId: alias.voiceActorId,
      name: alias.name,
      source: alias.source,
      verified: alias.verified,
    })),
  };
}

/** `normalizeName` が完全一致する声優の id。表記揺れ ("上田 麗奈" → "上田麗奈") を拾う */
async function matchByNormalizedName(db: AppDb, query: string): Promise<string[]> {
  const normalizedQuery = normalizeName(query);
  if (normalizedQuery.length === 0) return [];

  const { actors, aliases } = await loadActorIndex(db);
  const matched = new Set<string>();
  for (const actor of actors) {
    if (normalizeName(actor.canonicalName) === normalizedQuery) matched.add(actor.id);
    if (actor.nameKana && normalizeName(actor.nameKana) === normalizedQuery) matched.add(actor.id);
  }
  for (const alias of aliases) {
    if (normalizeName(alias.name) === normalizedQuery) matched.add(alias.voiceActorId);
  }
  return [...matched];
}

/** 1 声優につき何作品に credit があるか。同じ作品に複数 credit が付くので distinct で数える */
const workCountExpression = sql<number>`count(distinct ${audioCredits.audioWorkId})`;

/**
 * この声優の作品が載っているストアを 1 行にまとめたもの ("dlsite,audible")。
 *
 * SQLite の `group_concat` は `distinct` を付けると区切り文字を指定できないので "," 固定になる。
 * ストアの slug に "," は入らないので、読む側は素朴に分割してよい (`toStoreSlugs`)
 */
const storeSlugsExpression = sql<string | null>`group_concat(distinct ${storeListings.storeSlug})`;

/**
 * 作品が 1 件以上ある声優かどうか。sitemap に載せる声優を選ぶのに使う
 * (`sitemapEntries` (queries/works.ts))。
 *
 * EXISTS にするのは、声優 1 人ずつ作品数を引き直すと 2,500 人ぶんのクエリになるため。
 * 1 件見つかった時点で打ち切られるので、作品数を数えるより安い
 */
export const hasAnyAudioCredit: SQL = sql`exists (
  select 1 from ${audioCredits} where ${audioCredits.voiceActorId} = ${voiceActors.id}
)`;

/**
 * ページが出る声優かどうか。音声作品か出演アニメのどちらかがあれば出る
 * (404 の条件は `routes/voice-actors.$slug.tsx`)。
 *
 * 一覧と検索がこれで絞るのは、どちらも声優ページへのリンクを並べる場所だから。
 * 絞らないと 404 になるページへのリンクが並ぶ
 */
const hasPage: SQL = sql`(${hasAnyAudioCredit} or exists (
  select 1 from ${animeAppearances}
  where ${animeAppearances.voiceActorId} = ${voiceActors.id}
))`;

/**
 * 一覧・検索で共有する select。`extra` は呼び出し側の追加条件。
 *
 * 作品の有無で絞らない (絞るのは `hasPage`)。作品が 1 件も無い声優は leftJoin の相手が
 * 居ないので `workCount` が 0、`storeSlugs` が空で返る。
 *
 * 作品数もストアも年齢区分で絞らない。保存する時点で許可集合の外 (R18) を弾いているので
 * (`ingest`)、ここで絞っても結果は変わらず、全声優ぶんの集計に `audio_works` の join が増えるだけになる
 */
function summaryQuery(db: AppDb, extra?: SQL) {
  return (
    db
      .select({
        id: voiceActors.id,
        slug: voiceActors.slug,
        canonicalName: voiceActors.canonicalName,
        nameKana: voiceActors.nameKana,
        nameEn: voiceActors.nameEn,
        imageUrl: voiceActors.imageUrl,
        status: voiceActors.status,
        gender: voiceActors.gender,
        workCount: workCountExpression,
        storeSlugs: storeSlugsExpression,
      })
      .from(voiceActors)
      .leftJoin(audioCredits, eq(audioCredits.voiceActorId, voiceActors.id))
      // 作品がどのストアに載っているかは listing が持つ。作品 1 件につき行が増えるが、
      // 作品数は count(distinct) で数えているので重複しても狂わない
      .leftJoin(storeListings, eq(storeListings.audioWorkId, audioCredits.audioWorkId))
      .where(extra === undefined ? hasPage : and(hasPage, extra))
      .groupBy(voiceActors.id)
  );
}

/** summaryQuery が返す行。select の指定と手で合わせる */
type ActorSummaryRow = {
  id: string;
  slug: string;
  canonicalName: string;
  nameKana: string | null;
  nameEn: string | null;
  imageUrl: string | null;
  status: VoiceActor["status"];
  gender: VoiceActor["gender"];
  workCount: number;
  storeSlugs: string | null;
};

function toActorSummary(row: ActorSummaryRow): ActorSummary {
  return {
    id: row.id,
    slug: row.slug,
    canonicalName: row.canonicalName,
    ...(row.nameKana ? { nameKana: row.nameKana } : {}),
    ...(row.nameEn ? { nameEn: row.nameEn } : {}),
    ...(row.imageUrl ? { imageUrl: row.imageUrl } : {}),
    status: row.status,
    gender: row.gender,
    workCount: Number(row.workCount ?? 0),
    storeSlugs: toStoreSlugs(row.storeSlugs),
  };
}

/**
 * `group_concat` の結果を slug の配列に戻す。
 *
 * `STORE_SLUGS` 側から拾うので、並びは画面に出す順に揃い、知らない値は落ちる。
 * ストアが増えて DB に古い slug が残っていても、画面には出せないものを渡さずに済む
 */
function toStoreSlugs(concatenated: string | null): StoreSlug[] {
  if (!concatenated) return [];
  const found = new Set(concatenated.split(","));
  return STORE_SLUGS.filter((slug) => found.has(slug));
}

type VoiceActorRow = typeof voiceActors.$inferSelect;

/** DB の null と ドメイン型の optional を突き合わせる。null を漏らすと画面側で扱いが割れる */
export function toVoiceActor(row: VoiceActorRow): VoiceActor {
  return {
    id: row.id,
    slug: row.slug,
    canonicalName: row.canonicalName,
    ...(row.nameKana ? { nameKana: row.nameKana } : {}),
    ...(row.nameEn ? { nameEn: row.nameEn } : {}),
    ...(row.anilistStaffId !== null ? { anilistStaffId: row.anilistStaffId } : {}),
    ...(row.imageUrl ? { imageUrl: row.imageUrl } : {}),
    status: row.status,
    gender: row.gender,
  };
}
