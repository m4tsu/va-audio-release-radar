import { and, asc, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import type { AniListAnimeInput, AniListAppearanceInput } from "@/contract";
import type { AnimeRole, AnimeSeason, WorkCategory } from "@/domain/types";
import { seasonOrder } from "@/domain/types";
import { chunked, SQL_IN_CHUNK_SIZE } from "../db/chunked";
import { stripLikeWildcards } from "../db/like";
import {
  animeAppearances,
  animeTitleSynonyms,
  animeTitles,
  audioCredits,
  audioWorks,
  voiceActors,
} from "../db/schema";
import type { AppDb } from "../db/types";
import { resolvedNameEn } from "./actor-attributes";
import { notAdultRated, onSaleSomewhere } from "./works";

/**
 * アニメ導線。
 *
 * 一覧・検索・sitemap は「音声作品を持つ出演者が 1 人以上いる作品」だけを返す。中身の無い
 * ページへ送らないため。絞り込みを画面側ではなくここに置いているのは、画面を足すたびに
 * 忘れないようにするため。
 *
 * 例外は作品 1 件のページ (`getAnimeBySlug`) で、そこは出演者も作品も絞らない。まだ音声作品を
 * 出していない人をフォローする経路がここしか無いため。そのページは検索エンジンに載せない
 * (`docs/decisions/0012-follow-actors-without-works.md`)
 */

// --- 取り込み --------------------------------------------------------------

/**
 * 取り込みが受け取る 1 作品。AniList の取り込み (`queries/anilist.ts`) が
 * 出演を staff id から声優の ID に付け替えて渡す
 */
export type AnimeSeed = Omit<AniListAnimeInput, "appearances"> & {
  appearances: Array<Omit<AniListAppearanceInput, "anilistStaffId"> & { voiceActorId: string }>;
};

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
 * 出演の行の声優が、買える音声作品を 1 件でも持つかどうか。
 *
 * 数はトリガーが声優の行に持たせている (`voice_actors.on_sale_work_count`)。
 * credit と listing を辿り直すと、出演の行ごとにその声優の作品を読むことになる
 */
const appearanceActorHasAudioWork = sql`exists (
  select 1 from ${voiceActors}
  where ${voiceActors.id} = ${animeAppearances.voiceActorId}
    and ${voiceActors.onSaleWorkCount} > 0
)`;

/**
 * 買える作品を持つ出演者が 1 人以上いるアニメか。一覧・検索・sitemap に出す条件。
 * 人数はトリガーがアニメの行に持たせている (`anime_titles.on_sale_actor_count`)
 */
const titleHasOnSaleActor = sql`${animeTitles.onSaleActorCount} > 0`;

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
  /** 先頭から何件までか。`/anime` が抜粋を出すのに使う。省くと全件 */
  limit?: number,
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
        titleHasOnSaleActor,
        // 印と絞り込みに使う出演者 ID は、買える作品を持つ人に限る (人数と同じ意味にする)
        appearanceActorHasAudioWork,
      ),
    )
    .groupBy(animeTitles.id)
    // 人気の高い順。SQLite は NULL を最小として扱うので、人気度を持たない作品は降順の末尾に来る。
    // 同じ値は slug 順で安定させる (実行のたびに並びが変わらないように)
    .orderBy(desc(animeTitles.popularity), asc(animeTitles.slug))
    // 抜粋だけが要るときは DB 側で切る。SQLite は負の LIMIT を「制限なし」として扱う
    .limit(limit ?? -1);

  // 人気度そのものは画面に出さないので返さない
  return rows.map((row) => {
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
      animeCount: sql<number>`count(*)`,
    })
    .from(animeTitles)
    .where(titleHasOnSaleActor)
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
    .where(
      and(
        eq(animeTitles.seasonYear, seasonYear),
        eq(animeTitles.season, season),
        titleHasOnSaleActor,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * 作品 1 件。出演者は全員を、主演 → 助演の順で返す。
 *
 * 出演者を音声作品のある人に絞らないのは、まだ 1 本も出していない人もここからフォローできる
 * ようにするため。声優ページの「出演アニメ」は出演者の音声作品の有無で絞らないので、
 * ここで絞ると 404 へのリンクが並ぶ。
 * 音声作品がある出演者が 0 人の作品は `actorCount` が 0 になり、呼び出し側が noindex にする
 * (`docs/decisions/0012-follow-actors-without-works.md`)。
 * 出演が 1 件も無い作品だけ undefined を返す (呼び出し側は notFound())
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
      actorNameEn: resolvedNameEn,
      actorImageUrl: voiceActors.imageUrl,
    })
    .from(animeTitles)
    .innerJoin(animeAppearances, eq(animeAppearances.animeTitleId, animeTitles.id))
    .innerJoin(voiceActors, eq(voiceActors.id, animeAppearances.voiceActorId))
    .where(eq(animeTitles.slug, slug));

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

  // `actorCount` は「音声作品がある出演者」の人数 (一覧のカードと同じ意味)。
  // `loadWorkCountsByActor` は 1 件も無い出演者の行を作らないので、その大きさがそのまま人数になる
  return {
    ...toAnimeSummary({ ...head, actorCount: workCounts.size }),
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
        actorCount: animeTitles.onSaleActorCount,
      })
      .from(animeTitles)
      .where(and(inArray(animeTitles.id, ids), titleHasOnSaleActor));

    found.push(...rows.map(toAnimeSummary));
  }

  return found
    .sort((a, b) => seasonOrder(b) - seasonOrder(a) || a.slug.localeCompare(b.slug))
    .slice(0, limit);
}

/**
 * アニメ名の検索。日本語名・ローマ字名・英語名・別名タイトルの部分一致 (SQL の LIKE)。
 *
 * 別名は `anime_title_synonyms` (AniList が返す `synonyms`。取れる項目は `docs/stores/anilist.md`)。
 * 声優検索 (`searchActors`) が併用している `matchByNormalizedName` は正規化したうえでの
 * 完全一致なので、題の一部を打って探すこの検索には使えない
 */
export async function searchAnime(db: AppDb, q: string, limit = 20): Promise<AnimeSummary[]> {
  // ワイルドカードを落とした結果が空なら引かない ("%" だけの検索語が全件一致になるため)
  const literal = stripLikeWildcards(q.trim());
  if (literal.length === 0) return [];
  const pattern = `%${literal}%`;

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
      actorCount: animeTitles.onSaleActorCount,
    })
    .from(animeTitles)
    .leftJoin(animeTitleSynonyms, eq(animeTitleSynonyms.animeTitleId, animeTitles.id))
    .where(
      and(
        or(
          like(animeTitles.titleNative, pattern),
          like(animeTitles.titleRomaji, pattern),
          like(animeTitles.titleEnglish, pattern),
          like(animeTitleSynonyms.name, pattern),
        ),
        titleHasOnSaleActor,
      ),
    )
    .groupBy(animeTitles.id)
    // 一覧と同じ並び (人気の高い順)。SQLite は NULL を最小として扱うので、
    // 人気度を持たない作品は降順の末尾に来る。同じ値は slug 順で安定させる
    .orderBy(desc(animeTitles.popularity), asc(animeTitles.slug))
    // 打鍵が止まるたびに走るので、一致した全件を読まずに DB 側で切る
    .limit(limit);

  return rows.map(toAnimeSummary);
}

/** sitemap.xml に並べるアニメページ。声優ページと同じく、中身が出ないものは載せない */
export async function animeSitemapEntries(
  db: AppDb,
): Promise<Array<{ slug: string; updatedAt: string }>> {
  const rows = await db
    .select({ slug: animeTitles.slug, updatedAt: animeTitles.updatedAt })
    .from(animeTitles)
    .where(titleHasOnSaleActor)
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
      .where(and(inArray(audioCredits.voiceActorId, chunk), notAdultRated, onSaleSomewhere))
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
