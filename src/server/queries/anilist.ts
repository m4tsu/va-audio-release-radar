import { count, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { slugWithStaffId, toActorId, toActorNameEn, toActorSlug } from "@/domain/actor-slug";
import { ANIME_SEASONS, VOICE_ACTOR_GENDERS } from "@/domain/types";
import { chunked } from "../db/chunked";
import { anilistIngestRuns, animeAppearances, voiceActors } from "../db/schema";
import type { AppDb } from "../db/types";
import { type AnimeSeed, animeSeedSchema, upsertAnime } from "./anime";
import { clearScreened } from "./screened";

/**
 * AniList から取った 1 回ぶんを台帳に足す。
 *
 * 台帳は DB で、行は消さない。今回の応答に出なかった声優・作品・出演も残す。
 * シーズンの窓と 1 作品あたりの取得人数は取得の範囲を絞る条件であって、対象から外す条件ではない。
 *
 * 声優は staff id で引き当てる。名前は表記が変わりうるので鍵にしない。
 * 初めて見る staff id にだけ行を作り、既に居る声優は供給元の写し
 * (日本語表記・ローマ字・性別・画像・最後に見たシーズン) だけを更新する。
 * 同一性 (id / slug / 初めて見た日時) と付加情報・別名義には触らない
 */

// --- 入力 ------------------------------------------------------------------

const seasonSchema = z.object({
  year: z.number().int(),
  season: z.enum(ANIME_SEASONS),
});

/**
 * 出演者 1 人。AniList が言っている値だけを受け取る。
 * 声優の ID と slug はこちらが決めるので、送り手は持たない
 */
const anilistActorSchema = z.object({
  anilistStaffId: z.number().int(),
  /** 日本語表記。ストアとの突き合わせに使う唯一の鍵 */
  nativeName: z.string().min(1),
  /** "Reina Ueda"。slug の元であり、英語表示に出す名前 */
  fullName: z.string().optional(),
  gender: z.enum(VOICE_ACTOR_GENDERS).optional(),
  imageUrl: z.string().optional(),
  /** この声優の出演を確認した、今回の取得で一番新しいシーズン */
  latestSeason: seasonSchema.optional(),
});

export type AniListActorInput = z.infer<typeof anilistActorSchema>;

/**
 * 作品 1 件。出演は声優の ID ではなく staff id で指す。
 * ID を決めるのはこちら側なので、送り手はまだ知らない
 */
const anilistAnimeSchema = animeSeedSchema.omit({ appearances: true }).extend({
  appearances: z
    .array(
      z.object({
        anilistStaffId: z.number().int(),
        characterId: z.string().min(1),
        characterNameNative: z.string().optional(),
        characterNameFull: z.string().optional(),
        characterImageUrl: z.string().optional(),
        role: animeSeedSchema.shape.appearances.element.shape.role,
      }),
    )
    .min(1),
});

export const anilistIngestPayloadSchema = z.object({
  protocolVersion: z.number().int(),
  runId: z.string().min(1),
  startedAt: z.string().min(1),
  /** 今回の取得が対象にしたシーズン。古い順。取れた作品が 0 件でも記録に残す */
  seasons: z.array(seasonSchema).min(1),
  actors: z.array(anilistActorSchema),
  anime: z.array(anilistAnimeSchema),
});

export type AniListIngestPayload = z.infer<typeof anilistIngestPayloadSchema>;

// --- 結果 ------------------------------------------------------------------

/** 今回はじめて台帳に入った声優。後続のかな取得と声優名での検索がこれを使う */
export type NewActor = {
  id: string;
  slug: string;
  canonicalName: string;
  anilistStaffId: number;
};

export type AniListIngestResult = {
  runId: string;
  /** 送られた声優の数 */
  actors: number;
  newActors: NewActor[];
  /** ローマ字が無く slug を作れないので足さなかった声優の数 */
  skippedActors: number;
  anime: number;
  /** 保存した出演の数 (更新も含む) */
  appearances: number;
  /** そのうち今回はじめて入ったもの */
  newAppearances: number;
  /** 保存した別名タイトルの数 */
  synonyms: number;
  /** 声優が増えたので捨てた「対象声優が居ない」の判断の数 */
  clearedScreened: number;
};

// --- 本体 ------------------------------------------------------------------

export async function ingestAniList(
  db: AppDb,
  payload: AniListIngestPayload,
  now: string = new Date().toISOString(),
): Promise<AniListIngestResult> {
  const { actorIdByStaffId, newActors, skippedActors } = await upsertAniListActors(
    db,
    payload.actors,
    now,
  );

  // 「増えた出演」は前後の行数の差で数える。upsert は挿入と更新を分けて返さないため
  const appearancesBefore = await countAppearances(db);
  const animeResult = await upsertAnime(db, toAnimeSeeds(payload.anime, actorIdByStaffId), now);
  const newAppearances = (await countAppearances(db)) - appearancesBefore;

  // 声優が増えたら、過去の「対象声優が居ない」の判断を捨てる。
  // 捨てないと、新しく追い始めた声優の既存作品が新着一覧から永久に入らない
  const clearedScreened = newActors.length > 0 ? await clearScreened(db) : 0;

  await recordRun(db, payload, {
    finishedAt: now,
    animeCount: animeResult.titles,
    newActorCount: newActors.length,
    newAppearanceCount: newAppearances,
  });

  return {
    runId: payload.runId,
    actors: payload.actors.length,
    newActors,
    skippedActors,
    anime: animeResult.titles,
    appearances: animeResult.appearances,
    newAppearances,
    synonyms: animeResult.synonyms,
    clearedScreened,
  };
}

/**
 * 出演の staff id を声優 ID に置き換える。
 *
 * 置き換えられない出演 (slug を作れず足さなかった声優) はその 1 件だけを落とす。
 * 出演が 1 件も残らない作品は送らない (`upsertAnime` が 1 件以上を要求する)
 */
function toAnimeSeeds(
  anime: AniListIngestPayload["anime"],
  actorIdByStaffId: ReadonlyMap<number, string>,
): AnimeSeed[] {
  const seeds: AnimeSeed[] = [];
  for (const title of anime) {
    const appearances = title.appearances.flatMap((appearance) => {
      const voiceActorId = actorIdByStaffId.get(appearance.anilistStaffId);
      if (voiceActorId === undefined) return [];
      return [
        {
          voiceActorId,
          characterId: appearance.characterId,
          ...(appearance.characterNameNative === undefined
            ? {}
            : { characterNameNative: appearance.characterNameNative }),
          ...(appearance.characterNameFull === undefined
            ? {}
            : { characterNameFull: appearance.characterNameFull }),
          ...(appearance.characterImageUrl === undefined
            ? {}
            : { characterImageUrl: appearance.characterImageUrl }),
          role: appearance.role,
        },
      ];
    });
    if (appearances.length === 0) continue;
    seeds.push({ ...title, appearances });
  }
  return seeds;
}

/**
 * 声優を staff id で引き当てて足す / 更新する。
 *
 * 返す対応表には足せた声優が全員入る (新規も既存も)。出演の付け替えに使う
 */
async function upsertAniListActors(
  db: AppDb,
  actors: readonly AniListActorInput[],
  now: string,
): Promise<{
  actorIdByStaffId: Map<number, string>;
  newActors: NewActor[];
  skippedActors: number;
}> {
  const actorIdByStaffId = await loadActorIdsByStaffId(
    db,
    actors.map((actor) => actor.anilistStaffId),
  );
  // slug は URL に出るので、今ある全員ぶんと突き合わせてから決める。
  // 今回の取得の中だけで見ると、既に居る別人と同じ slug を新しい声優に与えてしまう
  const takenSlugs = await loadTakenSlugs(db);
  const newActors: NewActor[] = [];
  let skippedActors = 0;

  for (const actor of actors) {
    const existingId = actorIdByStaffId.get(actor.anilistStaffId);
    const supplied = suppliedColumns(actor);

    if (existingId !== undefined) {
      await db
        .update(voiceActors)
        .set({ ...supplied, updatedAt: now })
        .where(eq(voiceActors.id, existingId));
      continue;
    }

    const created = newActorRow(actor, takenSlugs);
    if (created === undefined) {
      skippedActors += 1;
      continue;
    }

    await db.insert(voiceActors).values({
      id: created.id,
      slug: created.slug,
      anilistStaffId: actor.anilistStaffId,
      ...supplied,
      status: "active",
      firstSeenAt: now,
      createdAt: now,
      updatedAt: now,
    });
    takenSlugs.add(created.slug);
    actorIdByStaffId.set(actor.anilistStaffId, created.id);
    newActors.push({ ...created, anilistStaffId: actor.anilistStaffId });
  }

  return { actorIdByStaffId, newActors, skippedActors };
}

/**
 * AniList が言っている値だけを写した列。既に居る声優ではここだけを上書きする。
 *
 * AniList が値を持たない項目は null で上書きする。前回の応答に有って今回無い値を残すと、
 * 供給元が消した事実とこちらが取り損ねた事実を区別できないまま古い値が居座る。
 * 人が直した表記は付加情報の表 (`voice_actor_attributes`) に別の行として残るので、この上書きで消えない
 */
function suppliedColumns(actor: AniListActorInput) {
  return {
    canonicalName: actor.nativeName.trim(),
    nameEn: toActorNameEn(actor.fullName) ?? null,
    gender: actor.gender ?? "unknown",
    imageUrl: actor.imageUrl ?? null,
    lastSeenSeasonYear: actor.latestSeason?.year ?? null,
    lastSeenSeason: actor.latestSeason?.season ?? null,
  };
}

/**
 * 新しい声優の ID と slug。slug を作れない声優 (ローマ字が無い / 記号だけ) は足さない。
 *
 * slug が既に使われていたら staff id を付ける。連番を振らないのは、取り込むたびに
 * 誰が 2 番目になるかが入れ替わり、別人の URL が入れ替わるため (`src/domain/actor-slug.ts`)
 */
function newActorRow(
  actor: AniListActorInput,
  takenSlugs: ReadonlySet<string>,
): { id: string; slug: string; canonicalName: string } | undefined {
  const base = toActorSlug(actor.fullName);
  if (base === undefined) return undefined;

  const slug = takenSlugs.has(base) ? slugWithStaffId(base, actor.anilistStaffId) : base;
  // staff id 付きでも埋まっているなら、その staff id の行が既にある (= 既存として扱われる) はず。
  // ここへ来るのは同じ取得に同じ staff id が 2 回入っていた場合なので、後の 1 件を落とす
  if (takenSlugs.has(slug)) return undefined;

  return { id: toActorId(slug), slug, canonicalName: actor.nativeName.trim() };
}

async function loadActorIdsByStaffId(
  db: AppDb,
  staffIds: readonly number[],
): Promise<Map<number, string>> {
  const found = new Map<number, string>();
  for (const chunk of chunked([...new Set(staffIds)])) {
    const rows = await db
      .select({ id: voiceActors.id, anilistStaffId: voiceActors.anilistStaffId })
      .from(voiceActors)
      .where(inArray(voiceActors.anilistStaffId, chunk));
    for (const row of rows) {
      if (row.anilistStaffId !== null) found.set(row.anilistStaffId, row.id);
    }
  }
  return found;
}

/** 今ある slug の全部。新しい声優の slug を決める前に読む */
async function loadTakenSlugs(db: AppDb): Promise<Set<string>> {
  const rows = await db.select({ slug: voiceActors.slug }).from(voiceActors);
  return new Set(rows.map((row) => row.slug));
}

async function countAppearances(db: AppDb): Promise<number> {
  const [row] = await db.select({ value: count() }).from(animeAppearances);
  return row?.value ?? 0;
}

/**
 * 走行の記録。同じ runId で送り直されたら上書きする (取り込みは冪等なので記録も 1 行に保つ)。
 * 対象シーズンは範囲で持つ。取得するシーズンは連続していて、両端と個数で言い表せる
 */
async function recordRun(
  db: AppDb,
  payload: AniListIngestPayload,
  counts: {
    finishedAt: string;
    animeCount: number;
    newActorCount: number;
    newAppearanceCount: number;
  },
): Promise<void> {
  const from = payload.seasons[0];
  const to = payload.seasons.at(-1);
  // zod が 1 件以上を保証しているので、ここに来る時点で両端は必ずある
  if (from === undefined || to === undefined) return;

  const values = {
    finishedAt: counts.finishedAt,
    seasonFromYear: from.year,
    seasonFrom: from.season,
    seasonToYear: to.year,
    seasonTo: to.season,
    seasonCount: payload.seasons.length,
    animeCount: counts.animeCount,
    actorCount: payload.actors.length,
    newActorCount: counts.newActorCount,
    newAppearanceCount: counts.newAppearanceCount,
  };

  await db
    .insert(anilistIngestRuns)
    .values({ id: payload.runId, startedAt: payload.startedAt, ...values })
    .onConflictDoUpdate({ target: anilistIngestRuns.id, set: values });
}
