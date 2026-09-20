import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { AnimeRole, AnimeSeason, WorkCategory } from "@/domain/types";
import { ANIME_FORMATS, ANIME_ROLES, ANIME_SEASONS, seasonOrder } from "@/domain/types";
import { chunked, SQL_IN_CHUNK_SIZE } from "../db/chunked";
import {
  animeAppearances,
  animeTitleSynonyms,
  animeTitles,
  audioCredits,
  audioWorks,
  voiceActors,
} from "../db/schema";
import type { AppDb } from "../db/types";
import { notAdultRated } from "./works";

/**
 * アニメ導線。
 *
 * 読み取りはすべて「音声作品を持つ声優だけ」で絞る。全キャストを並べるとキャスト DB になり、
 * `docs/product.md` の「作らないもの」(アニメのキャスト DB) を越えるため。
 * 絞り込みを画面側ではなくここに置いているのは、画面を足すたびに忘れないようにするため
 */

// --- 取り込み --------------------------------------------------------------

/** 放送日。発売日 (`releaseDateSchema`) と同じ形で受け取る */
const animeDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 形式で指定する");

/** `POST /api/admin/anime` が受け取る 1 作品。`crawler/anime.generated.json` の 1 要素と同じ形 */
export const animeSeedSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  titleNative: z.string().optional(),
  titleRomaji: z.string().min(1),
  titleEnglish: z.string().optional(),
  seasonYear: z.number().int(),
  season: z.enum(ANIME_SEASONS),
  coverImageUrl: z.string().optional(),
  coverImageColor: z.string().optional(),
  format: z.enum(ANIME_FORMATS).optional(),
  popularity: z.number().int().optional(),
  // 年月日が揃った日付だけを受け取る。部分的な日付 (年だけ) は生成側で落としてある
  startDate: animeDateSchema.optional(),
  endDate: animeDateSchema.optional(),
  synonyms: z.array(z.string().min(1)).optional(),
  appearances: z
    .array(
      z.object({
        voiceActorId: z.string().min(1),
        characterId: z.string().min(1),
        characterNameNative: z.string().optional(),
        characterNameFull: z.string().optional(),
        characterImageUrl: z.string().optional(),
        role: z.enum(ANIME_ROLES),
      }),
    )
    .min(1),
});

export type AnimeSeed = z.infer<typeof animeSeedSchema>;

export type AnimeIngestResult = {
  titles: number;
  appearances: number;
  /** DB に居ない声優を指していて捨てた出演の数 */
  skippedAppearances: number;
  /** 保存した別名タイトルの数 */
  synonyms: number;
};

/**
 * アニメの投入。id / slug は入力をそのまま使う (slug は URL に出るので自動採番にしない)。
 *
 * 前回含まれていて今回含まれない行は消さない。AniList 側で出演が消えたのか、
 * こちらの取得範囲 (シーズン数・1 シーズンあたりの件数) が変わっただけなのかを
 * 区別できないため。消す条件は別に決める
 */
export async function upsertAnime(
  db: AppDb,
  anime: AnimeSeed[],
  now: string = new Date().toISOString(),
): Promise<AnimeIngestResult> {
  const knownActorIds = await loadKnownActorIds(db, anime);

  let appearanceCount = 0;
  let skippedAppearances = 0;
  let synonymCount = 0;

  for (const title of anime) {
    const values = {
      slug: title.slug,
      titleNative: title.titleNative ?? title.titleRomaji,
      titleRomaji: title.titleRomaji,
      titleEnglish: title.titleEnglish ?? null,
      seasonYear: title.seasonYear,
      season: title.season,
      coverImageUrl: title.coverImageUrl ?? null,
      coverImageColor: title.coverImageColor ?? null,
      format: title.format ?? null,
      popularity: title.popularity ?? null,
      startDate: title.startDate ?? null,
      endDate: title.endDate ?? null,
    };

    await db
      .insert(animeTitles)
      .values({ id: title.id, ...values, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: animeTitles.id,
        set: { ...values, updatedAt: now },
      });

    synonymCount += await replaceSynonyms(db, title.id, title.synonyms ?? []);

    for (const appearance of title.appearances) {
      // 声優のシード投入より先にアニメを流すと外部キー違反で全体が落ちる。
      // 落とさずに数えて返し、投入の順序を間違えたことに気づけるようにする
      if (!knownActorIds.has(appearance.voiceActorId)) {
        skippedAppearances += 1;
        continue;
      }

      await db
        .insert(animeAppearances)
        .values({
          animeTitleId: title.id,
          voiceActorId: appearance.voiceActorId,
          characterId: appearance.characterId,
          characterNameNative: appearance.characterNameNative ?? "",
          characterNameFull: appearance.characterNameFull ?? null,
          characterImageUrl: appearance.characterImageUrl ?? null,
          role: appearance.role,
        })
        .onConflictDoUpdate({
          target: [
            animeAppearances.animeTitleId,
            animeAppearances.characterId,
            animeAppearances.voiceActorId,
          ],
          set: {
            characterNameNative: appearance.characterNameNative ?? "",
            characterNameFull: appearance.characterNameFull ?? null,
            characterImageUrl: appearance.characterImageUrl ?? null,
            role: appearance.role,
          },
        });
      appearanceCount += 1;
    }
  }

  return {
    titles: anime.length,
    appearances: appearanceCount,
    skippedAppearances,
    synonyms: synonymCount,
  };
}

/**
 * 1 作品の別名タイトルを入れ替える。入れた件数を返す。
 *
 * 差分を取らずに消してから入れ直すのは、AniList 側で別名が消えたときに古い行が残ると、
 * もう存在しない名前で検索に当たってしまうため。出演 (`anime_appearances`) を消さない方針とは
 * 逆だが、別名はタイトルに完全に従属していて「こちらの取得範囲が変わっただけ」という
 * 取り違えが起きない
 */
async function replaceSynonyms(db: AppDb, animeTitleId: string, names: string[]): Promise<number> {
  await db.delete(animeTitleSynonyms).where(eq(animeTitleSynonyms.animeTitleId, animeTitleId));

  // 同じ名前が 2 度入っている応答があっても落とさない
  const unique = [...new Set(names)];
  if (unique.length === 0) return 0;

  // 1 行につき (作品 id, 名前) の 2 つを bind するので、IN 句の既定のままでは D1 の上限を超える。
  // 上限ちょうどではなく既定の半分にして、IN 句と同じだけの余白を残す
  for (const chunk of chunked(unique, Math.floor(SQL_IN_CHUNK_SIZE / 2))) {
    await db
      .insert(animeTitleSynonyms)
      .values(chunk.map((name) => ({ animeTitleId, name })))
      .onConflictDoNothing();
  }
  return unique.length;
}

/** 投入対象が指している声優のうち、実際に DB に居る id。D1 の bound parameter 上限で分割する */
async function loadKnownActorIds(db: AppDb, anime: AnimeSeed[]): Promise<Set<string>> {
  const referenced = new Set<string>();
  for (const title of anime) {
    for (const appearance of title.appearances) referenced.add(appearance.voiceActorId);
  }
  if (referenced.size === 0) return new Set();

  const known = new Set<string>();
  for (const chunk of chunked([...referenced])) {
    const rows = await db
      .select({ id: voiceActors.id })
      .from(voiceActors)
      .where(inArray(voiceActors.id, chunk));
    for (const row of rows) known.add(row.id);
  }
  return known;
}

// --- 読み取り --------------------------------------------------------------

export type AnimeSummary = {
  slug: string;
  titleNative: string;
  titleRomaji: string;
  titleEnglish?: string;
  seasonYear: number;
  season: AnimeSeason;
  coverImageUrl?: string;
  /** 音声作品を持つ出演者の人数。0 人の作品はそもそも返さない */
  actorCount: number;
};

export type AnimeCastMember = {
  characterId: string;
  characterNameNative: string;
  characterNameFull?: string;
  characterImageUrl?: string;
  role: AnimeRole;
  actor: {
    id: string;
    slug: string;
    canonicalName: string;
    nameEn?: string;
    imageUrl?: string;
  };
  /** 媒体別の音声作品数。0 件の媒体は入れない */
  workCounts: Array<{ category: WorkCategory; count: number }>;
};

export type AnimeDetail = AnimeSummary & { cast: AnimeCastMember[] };

/**
 * シーズン一覧の 1 件。`actorCount` に数えた出演者の ID を添える。
 *
 * フォローはブラウザの IndexedDB にしか無く、サーバーは誰をフォローしているかを知らない。
 * ID を一緒に返せば「フォロー中の声優が出ている作品」の判定を画面が自分で行えるので、
 * SSR の応答はフォローの有無で変わらないまま、印と絞り込みを出せる
 */
export type SeasonAnime = AnimeSummary & { actorIds: string[] };

/** 出せる作品があるシーズン 1 つ。`/anime` の索引と sitemap が並べる */
export type AnimeSeasonEntry = {
  seasonYear: number;
  season: AnimeSeason;
  /** そのシーズンで出せる作品数 */
  animeCount: number;
};

/** 声優ページに出す「出演アニメ」の 1 件 */
export type ActorAnimeAppearance = {
  slug: string;
  titleNative: string;
  titleRomaji: string;
  titleEnglish?: string;
  seasonYear: number;
  season: AnimeSeason;
  coverImageUrl?: string;
  characterNameNative: string;
  characterNameFull?: string;
  characterImageUrl?: string;
  role: AnimeRole;
};

/**
 * 音声作品を 1 件でも持つ声優かどうか。
 *
 * `hasAnyAudioCredit` (queries/actors.ts) は `voice_actors.id` に束縛されているので、
 * 出演の行から引くこちらは別に持つ。R18 を除くのは画面に出す条件と揃えるため
 */
const appearanceActorHasAudioWork = sql`exists (
  select 1 from ${audioCredits}
  inner join ${audioWorks} on ${audioWorks.id} = ${audioCredits.audioWorkId}
  where ${audioCredits.voiceActorId} = ${animeAppearances.voiceActorId}
    and ${notAdultRated}
)`;

/**
 * そのシーズンのアニメ一覧。人気の高い順。
 *
 * 音声作品を持つ出演者が 0 人の作品は返さない。
 * 出演者が全員「音声作品なし」の作品を並べても、行った先のページが空になる。
 *
 * 並べ替えの選択肢は画面側にあるが、既定の並びはここで作る。SSR が返す HTML が
 * 既定の並びになっていないと、ハイドレーションで順序が入れ替わって見えるため
 */
export async function listSeasonAnime(
  db: AppDb,
  seasonYear: number,
  season: AnimeSeason,
): Promise<SeasonAnime[]> {
  const rows = await db
    .select({
      slug: animeTitles.slug,
      titleNative: animeTitles.titleNative,
      titleRomaji: animeTitles.titleRomaji,
      titleEnglish: animeTitles.titleEnglish,
      seasonYear: animeTitles.seasonYear,
      season: animeTitles.season,
      coverImageUrl: animeTitles.coverImageUrl,
      popularity: animeTitles.popularity,
      actorIds: sql<string>`group_concat(distinct ${animeAppearances.voiceActorId})`,
    })
    .from(animeTitles)
    .innerJoin(animeAppearances, eq(animeAppearances.animeTitleId, animeTitles.id))
    .where(
      and(
        eq(animeTitles.seasonYear, seasonYear),
        eq(animeTitles.season, season),
        appearanceActorHasAudioWork,
      ),
    )
    .groupBy(animeTitles.id)
    .orderBy(asc(animeTitles.slug));

  // 人気の高い順。人気度を持たない作品は末尾へ送り、同じ値なら slug 順で安定させる
  // (実行のたびに並びが変わらないように)。人気度そのものは画面に出さないので返さない
  return rows
    .sort((a, b) => (b.popularity ?? -1) - (a.popularity ?? -1) || a.slug.localeCompare(b.slug))
    .map((row) => {
      const actorIds = splitIds(row.actorIds);
      return { ...toAnimeSummary({ ...row, actorCount: actorIds.length }), actorIds };
    });
}

/**
 * 出せる作品があるシーズン。新しい順。
 *
 * 「今期」を日付から決めない。クロールが追いつく前や季節の境目で、中身の無いシーズンへ
 * 誘導してしまうため。実際に作品があるシーズンだけを並べる
 */
export async function listSeasonsWithAnime(db: AppDb): Promise<AnimeSeasonEntry[]> {
  const rows = await db
    .select({
      seasonYear: animeTitles.seasonYear,
      season: animeTitles.season,
      animeCount: sql<number>`count(distinct ${animeTitles.id})`,
    })
    .from(animeTitles)
    .innerJoin(animeAppearances, eq(animeAppearances.animeTitleId, animeTitles.id))
    .where(appearanceActorHasAudioWork)
    .groupBy(animeTitles.seasonYear, animeTitles.season);

  // シーズン数はたかだか数十行なので、SQL で CASE を書くより JS 側で並べたほうが読める
  return rows
    .map((row) => ({
      seasonYear: row.seasonYear,
      season: row.season,
      animeCount: Number(row.animeCount ?? 0),
    }))
    .sort((a, b) => seasonOrder(b) - seasonOrder(a));
}

/** そのシーズンに出せる作品が 1 件でもあるか。トップの導線を出すかどうかの判定に使う */
export async function hasSeasonAnime(
  db: AppDb,
  seasonYear: number,
  season: AnimeSeason,
): Promise<boolean> {
  const rows = await db
    .select({ id: animeTitles.id })
    .from(animeTitles)
    .innerJoin(animeAppearances, eq(animeAppearances.animeTitleId, animeTitles.id))
    .where(
      and(
        eq(animeTitles.seasonYear, seasonYear),
        eq(animeTitles.season, season),
        appearanceActorHasAudioWork,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * 作品 1 件。出演者は音声作品を持つ人だけを、主演 → 助演の順で返す。
 *
 * 音声作品を持つ出演者が 0 人なら undefined。呼び出し側は notFound() を返す
 * (中身の無いページを 200 で返すと、検索エンジンから見て薄いページが並ぶため)
 */
export async function getAnimeBySlug(db: AppDb, slug: string): Promise<AnimeDetail | undefined> {
  const rows = await db
    .select({
      slug: animeTitles.slug,
      titleNative: animeTitles.titleNative,
      titleRomaji: animeTitles.titleRomaji,
      titleEnglish: animeTitles.titleEnglish,
      seasonYear: animeTitles.seasonYear,
      season: animeTitles.season,
      coverImageUrl: animeTitles.coverImageUrl,
      characterId: animeAppearances.characterId,
      characterNameNative: animeAppearances.characterNameNative,
      characterNameFull: animeAppearances.characterNameFull,
      characterImageUrl: animeAppearances.characterImageUrl,
      role: animeAppearances.role,
      actorId: voiceActors.id,
      actorSlug: voiceActors.slug,
      actorName: voiceActors.canonicalName,
      actorNameEn: voiceActors.nameEn,
      actorImageUrl: voiceActors.imageUrl,
    })
    .from(animeTitles)
    .innerJoin(animeAppearances, eq(animeAppearances.animeTitleId, animeTitles.id))
    .innerJoin(voiceActors, eq(voiceActors.id, animeAppearances.voiceActorId))
    .where(and(eq(animeTitles.slug, slug), appearanceActorHasAudioWork));

  const head = rows[0];
  if (head === undefined) return undefined;

  const workCounts = await loadWorkCountsByActor(db, [...new Set(rows.map((row) => row.actorId))]);

  const cast: AnimeCastMember[] = rows
    .map((row) => ({
      characterId: row.characterId,
      characterNameNative: row.characterNameNative,
      ...(row.characterNameFull ? { characterNameFull: row.characterNameFull } : {}),
      ...(row.characterImageUrl ? { characterImageUrl: row.characterImageUrl } : {}),
      role: row.role,
      actor: {
        id: row.actorId,
        slug: row.actorSlug,
        canonicalName: row.actorName,
        ...(row.actorNameEn ? { nameEn: row.actorNameEn } : {}),
        ...(row.actorImageUrl ? { imageUrl: row.actorImageUrl } : {}),
      },
      workCounts: workCounts.get(row.actorId) ?? [],
    }))
    .sort(byRoleThenName);

  return {
    ...toAnimeSummary({ ...head, actorCount: new Set(rows.map((row) => row.actorId)).size }),
    cast,
  };
}

/** 声優ページの「出演アニメ」。新しいシーズンから並べる */
export async function animeByActor(
  db: AppDb,
  voiceActorId: string,
  limit = 12,
): Promise<ActorAnimeAppearance[]> {
  const rows = await db
    .select({
      slug: animeTitles.slug,
      titleNative: animeTitles.titleNative,
      titleRomaji: animeTitles.titleRomaji,
      titleEnglish: animeTitles.titleEnglish,
      seasonYear: animeTitles.seasonYear,
      season: animeTitles.season,
      coverImageUrl: animeTitles.coverImageUrl,
      characterNameNative: animeAppearances.characterNameNative,
      characterNameFull: animeAppearances.characterNameFull,
      characterImageUrl: animeAppearances.characterImageUrl,
      role: animeAppearances.role,
    })
    .from(animeAppearances)
    .innerJoin(animeTitles, eq(animeTitles.id, animeAppearances.animeTitleId))
    .where(eq(animeAppearances.voiceActorId, voiceActorId));

  // シーズンの新旧は年 × 4 + シーズン番号。SQL で CASE を書くより JS 側で並べたほうが読める
  return rows
    .map((row) => ({
      slug: row.slug,
      titleNative: row.titleNative,
      titleRomaji: row.titleRomaji,
      ...(row.titleEnglish ? { titleEnglish: row.titleEnglish } : {}),
      seasonYear: row.seasonYear,
      season: row.season,
      ...(row.coverImageUrl ? { coverImageUrl: row.coverImageUrl } : {}),
      characterNameNative: row.characterNameNative,
      ...(row.characterNameFull ? { characterNameFull: row.characterNameFull } : {}),
      ...(row.characterImageUrl ? { characterImageUrl: row.characterImageUrl } : {}),
      role: row.role,
    }))
    .sort((a, b) => seasonOrder(b) - seasonOrder(a) || a.slug.localeCompare(b.slug))
    .slice(0, limit);
}

/**
 * フォロー中の声優が出ているアニメ。新しいシーズンから並べる。
 *
 * 誰をフォローしているかはブラウザにしか無いので、ID を受け取って引き直す (フィードと同じ形)。
 * 出演者の人数は「音声作品を持つ出演者」で数える。フォロー中の人数ではないのは、
 * 並ぶカードがシーズン一覧と同じ意味を持つようにするため
 */
export async function animeForActors(
  db: AppDb,
  voiceActorIds: string[],
  limit = 24,
): Promise<AnimeSummary[]> {
  if (voiceActorIds.length === 0) return [];

  const titleIds = new Set<string>();
  for (const ids of chunked(voiceActorIds)) {
    const rows = await db
      .selectDistinct({ animeTitleId: animeAppearances.animeTitleId })
      .from(animeAppearances)
      .where(inArray(animeAppearances.voiceActorId, ids));
    for (const row of rows) titleIds.add(row.animeTitleId);
  }
  if (titleIds.size === 0) return [];

  const found: AnimeSummary[] = [];
  for (const ids of chunked([...titleIds])) {
    const rows = await db
      .select({
        slug: animeTitles.slug,
        titleNative: animeTitles.titleNative,
        titleRomaji: animeTitles.titleRomaji,
        titleEnglish: animeTitles.titleEnglish,
        seasonYear: animeTitles.seasonYear,
        season: animeTitles.season,
        coverImageUrl: animeTitles.coverImageUrl,
        actorCount: sql<number>`count(distinct ${animeAppearances.voiceActorId})`,
      })
      .from(animeTitles)
      .innerJoin(animeAppearances, eq(animeAppearances.animeTitleId, animeTitles.id))
      .where(and(inArray(animeTitles.id, ids), appearanceActorHasAudioWork))
      .groupBy(animeTitles.id);

    found.push(...rows.map(toAnimeSummary));
  }

  return found
    .sort((a, b) => seasonOrder(b) - seasonOrder(a) || a.slug.localeCompare(b.slug))
    .slice(0, limit);
}

/** sitemap.xml に並べるアニメページ。声優ページと同じく、中身が出ないものは載せない */
export async function animeSitemapEntries(
  db: AppDb,
): Promise<Array<{ slug: string; updatedAt: string }>> {
  const rows = await db
    .selectDistinct({ slug: animeTitles.slug, updatedAt: animeTitles.updatedAt })
    .from(animeTitles)
    .innerJoin(animeAppearances, eq(animeAppearances.animeTitleId, animeTitles.id))
    .where(appearanceActorHasAudioWork)
    .orderBy(asc(animeTitles.slug));
  return rows;
}

// --- 内部 ------------------------------------------------------------------

/** 声優ごとの媒体別作品数。1 人ずつ引くと出演者の数だけクエリが出るのでまとめて 1 回で取る */
async function loadWorkCountsByActor(
  db: AppDb,
  actorIds: string[],
): Promise<Map<string, Array<{ category: WorkCategory; count: number }>>> {
  const counts = new Map<string, Array<{ category: WorkCategory; count: number }>>();
  if (actorIds.length === 0) return counts;

  for (const chunk of chunked(actorIds)) {
    const rows = await db
      .select({
        voiceActorId: audioCredits.voiceActorId,
        category: audioWorks.category,
        count: sql<number>`count(distinct ${audioWorks.id})`,
      })
      .from(audioCredits)
      .innerJoin(audioWorks, eq(audioWorks.id, audioCredits.audioWorkId))
      .where(and(inArray(audioCredits.voiceActorId, chunk), notAdultRated))
      .groupBy(audioCredits.voiceActorId, audioWorks.category);

    for (const row of rows) {
      if (row.voiceActorId === null) continue;
      const list = counts.get(row.voiceActorId) ?? [];
      list.push({ category: row.category, count: Number(row.count ?? 0) });
      counts.set(row.voiceActorId, list);
    }
  }

  // 件数の多い媒体から出す。同数はカテゴリ名で安定させる
  for (const list of counts.values()) {
    list.sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
  }
  return counts;
}

/** 主演を先に、同じ役の中は声優名の五十音順 */
function byRoleThenName(a: AnimeCastMember, b: AnimeCastMember): number {
  if (a.role !== b.role) return a.role === "main" ? -1 : 1;
  return a.actor.canonicalName.localeCompare(b.actor.canonicalName, "ja");
}

/**
 * `group_concat` が返すカンマ区切りを配列に戻す。
 * 声優 ID ("va_ueda-reina") にカンマは入らないので、区切りの取り違えは起きない
 */
function splitIds(value: string | null): string[] {
  if (!value) return [];
  return value.split(",").filter((id) => id.length > 0);
}

type AnimeSummaryRow = {
  slug: string;
  titleNative: string;
  titleRomaji: string;
  titleEnglish: string | null;
  seasonYear: number;
  season: AnimeSeason;
  coverImageUrl: string | null;
  actorCount: number;
};

/** DB の null と ドメイン型の optional を突き合わせる (`toVoiceActor` と同じ理由) */
function toAnimeSummary(row: AnimeSummaryRow): AnimeSummary {
  return {
    slug: row.slug,
    titleNative: row.titleNative,
    titleRomaji: row.titleRomaji,
    ...(row.titleEnglish ? { titleEnglish: row.titleEnglish } : {}),
    seasonYear: row.seasonYear,
    season: row.season,
    ...(row.coverImageUrl ? { coverImageUrl: row.coverImageUrl } : {}),
    actorCount: Number(row.actorCount ?? 0),
  };
}
