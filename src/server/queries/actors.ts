import { and, asc, eq, inArray, like, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { normalizeName } from "@/domain/normalize";
import type { VoiceActor, VoiceActorAlias } from "@/domain/types";
import { chunked } from "../db/chunked";
import { audioCredits, voiceActorAliases, voiceActors } from "../db/schema";
import type { AppDb } from "../db/types";

/** 一覧・検索結果の 1 行。作品数は声優ページへ行く前の目安として画面に出す */
export type ActorSummary = {
  id: string;
  slug: string;
  canonicalName: string;
  nameKana?: string;
  /** 英語表示のときだけ使う表記。画面側の actorDisplayName が見る (今は全件 NULL) */
  nameEn?: string;
  imageUrl?: string;
  status: VoiceActor["status"];
  workCount: number;
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
): Promise<{ actors: number; aliases: number }> {
  let aliasCount = 0;

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

  return { actors: actors.length, aliases: aliasCount };
}

/**
 * 声優一覧 (作品数付き、canonical_name 順)。
 *
 * 作品が 1 件も無い声優は返さない。追跡対象は AniList 由来の 2,500 人規模 で、
 * その大半は音声作品を出していない。クロール履歴を残すために DB には全員入れるが、
 * 中身の無いページへのリンクを並べても利用者の役に立たないため表には出さない
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
 * 声優検索。部分一致 (SQL の LIKE) と表記揺れ一致 (`normalizeName`) の和集合を返す。
 *
 * `normalizeName` は空白・中黒などを落とすので SQL では表現できない。名前だけを全件読んで
 * JS 側で突き合わせている (`matchByNormalizedName`)。追跡対象が 2,500 人規模になり
 * 1 回の検索で声優と別名を全件読むようになったので、遅くなったら正規化済みの列を持たせて
 * 索引を張る。作品が 1 件も無い声優は結果に含めない (`listActors` と同じ理由)
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
 * 作品が 1 件以上ある声優かどうか。
 *
 * EXISTS にするのは、声優 1 人ずつ作品数を引き直すと 2,500 人ぶんのクエリになるため。
 * 1 件見つかった時点で打ち切られるので、作品数を数えるより安い。
 * `sitemapEntries` (queries/works.ts) も同じ条件を使う
 */
export const hasAnyAudioCredit: SQL = sql`exists (
  select 1 from ${audioCredits} where ${audioCredits.voiceActorId} = ${voiceActors.id}
)`;

/** 一覧・検索で共有する select。`extra` は呼び出し側の追加条件 */
function summaryQuery(db: AppDb, extra?: SQL) {
  return db
    .select({
      id: voiceActors.id,
      slug: voiceActors.slug,
      canonicalName: voiceActors.canonicalName,
      nameKana: voiceActors.nameKana,
      nameEn: voiceActors.nameEn,
      imageUrl: voiceActors.imageUrl,
      status: voiceActors.status,
      workCount: workCountExpression,
    })
    .from(voiceActors)
    .leftJoin(audioCredits, eq(audioCredits.voiceActorId, voiceActors.id))
    .where(extra === undefined ? hasAnyAudioCredit : and(hasAnyAudioCredit, extra))
    .groupBy(voiceActors.id);
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
  workCount: number;
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
    workCount: Number(row.workCount ?? 0),
  };
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
  };
}

/**
 * LIKE のワイルドカードを落とす。検索語に "%" や "_" が入ったときに全件一致にならないようにする。
 * SQLite の ESCAPE 句は drizzle の `like` から渡せないので、エスケープではなく除去で済ませる
 */
function stripLikeWildcards(value: string): string {
  return value.replace(/[%_]/g, "");
}
