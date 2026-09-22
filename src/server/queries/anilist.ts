import { count, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { slugWithStaffId, toActorId, toActorNameEn, toActorSlug } from "@/domain/actor-slug";
import { ANIME_SEASONS, type AnimeSeason, seasonOrder, VOICE_ACTOR_GENDERS } from "@/domain/types";
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
 * 初めて見る staff id にだけ行を作り、既に居る声優は供給元が今回言った項目だけを更新する。
 * 同一性 (id / slug / 初めて見た日時) と、別表にある付加情報・別名義の行には触らない
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
  /**
   * 日本語表記。ストアとの突き合わせに使う唯一の鍵なので、
   * 空白を詰めて何も残らない名前は入口で弾く (空の名前で入るとどのストアにも当たらなくなる)
   */
  nativeName: z.string().trim().min(1),
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
  /** 声優を引き当てられずに落とした出演の数 */
  droppedAppearances: number;
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

  const { seeds, droppedAppearances } = toAnimeSeeds(payload.anime, actorIdByStaffId);
  // 「増えた出演」は前後の行数の差で数える (upsert は挿入と更新を分けて返さない)。
  // 数える範囲を今回の作品に絞るのは、表全体だと同時に走る別の取り込みが入れた行まで
  // この走行の増加として記録に残るため
  const titleIds = seeds.map((seed) => seed.id);
  const appearancesBefore = await countAppearances(db, titleIds);
  const animeResult = await upsertAnime(db, seeds, now);
  const newAppearances = (await countAppearances(db, titleIds)) - appearancesBefore;

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
    droppedAppearances,
    synonyms: animeResult.synonyms,
    clearedScreened,
  };
}

/**
 * 出演の staff id を声優 ID に置き換える。
 *
 * 置き換えられない出演 (足さなかった声優、送り手が `actors` に入れ忘れた staff id) は
 * その 1 件だけを落とし、件数を返す。数えないと、キャストが丸ごと落ちた取り込みが
 * 正常な件数とともに 200 を返す。出演が 1 件も残らない作品は送らない
 * (`upsertAnime` が 1 件以上を要求する)
 */
function toAnimeSeeds(
  anime: AniListIngestPayload["anime"],
  actorIdByStaffId: ReadonlyMap<number, string>,
): { seeds: AnimeSeed[]; droppedAppearances: number } {
  const seeds: AnimeSeed[] = [];
  let droppedAppearances = 0;
  for (const title of anime) {
    const appearances = title.appearances.flatMap((appearance) => {
      const voiceActorId = actorIdByStaffId.get(appearance.anilistStaffId);
      if (voiceActorId === undefined) {
        droppedAppearances += 1;
        return [];
      }
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
  return { seeds, droppedAppearances };
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
  const stored = await loadActorsByStaffId(
    db,
    actors.map((actor) => actor.anilistStaffId),
  );
  // slug は URL に出るので、今ある全員ぶんと突き合わせてから決める。
  // 今回の取得の中だけで見ると、既に居る別人と同じ slug を新しい声優に与えてしまう
  const taken = await loadTaken(db);
  const actorIdByStaffId = new Map<number, string>(
    [...stored].map(([staffId, row]) => [staffId, row.id]),
  );
  const newActors: NewActor[] = [];
  let skippedActors = 0;

  for (const actor of actors) {
    const existing = stored.get(actor.anilistStaffId);

    if (existing !== undefined) {
      await db
        .update(voiceActors)
        .set({ ...suppliedColumns(actor, existing), updatedAt: now })
        .where(eq(voiceActors.id, existing.id));
      continue;
    }

    const created = newActorRow(actor, taken);
    if (created === undefined) {
      skippedActors += 1;
      continue;
    }

    await db.insert(voiceActors).values({
      id: created.id,
      slug: created.slug,
      anilistStaffId: actor.anilistStaffId,
      ...suppliedColumns(actor),
      // 新しい行にだけ既定値を置く。既に居る声優には触らない (別の経路が埋めた値を消さないため)
      gender: actor.gender ?? "unknown",
      status: "active",
      firstSeenAt: now,
      createdAt: now,
      updatedAt: now,
    });
    taken.slugs.add(created.slug);
    taken.ids.add(created.id);
    stored.set(actor.anilistStaffId, {
      id: created.id,
      lastSeenSeasonYear: actor.latestSeason?.year ?? null,
      lastSeenSeason: actor.latestSeason?.season ?? null,
    });
    actorIdByStaffId.set(actor.anilistStaffId, created.id);
    newActors.push({ ...created, anilistStaffId: actor.anilistStaffId });
  }

  return { actorIdByStaffId, newActors, skippedActors };
}

/**
 * 既に居る声優に上書きする列。**送られてきた項目だけ**を書く。
 *
 * 送られてこない項目は「供給元が値を失った」ではなく「この経路では分からない」。
 * シーズンの応答は性別を言わない声優がいて、その穴は staff id で直接引く別の経路が埋める。
 * 無条件に null や "unknown" で上書きすると、埋めた値が取り込みのたびに消える。
 *
 * 最後に見たシーズンだけは新しい方を採る。古いシーズンを後から埋め戻す走行で、
 * 「最後に確認した」が過去へ戻らないようにするため
 */
function suppliedColumns(
  actor: AniListActorInput,
  stored?: { lastSeenSeasonYear: number | null; lastSeenSeason: AnimeSeason | null },
) {
  const latest = latestSeasonOf(actor, stored);
  return {
    canonicalName: actor.nativeName,
    ...(actor.fullName === undefined ? {} : { nameEn: toActorNameEn(actor.fullName) ?? null }),
    ...(actor.gender === undefined ? {} : { gender: actor.gender }),
    ...(actor.imageUrl === undefined ? {} : { imageUrl: actor.imageUrl }),
    ...(latest === undefined
      ? {}
      : { lastSeenSeasonYear: latest.year, lastSeenSeason: latest.season }),
  };
}

/** 保存済みと今回のうち新しい方のシーズン。どちらも無ければ undefined (列に触らない) */
function latestSeasonOf(
  actor: AniListActorInput,
  stored?: { lastSeenSeasonYear: number | null; lastSeenSeason: AnimeSeason | null },
): { year: number; season: AnimeSeason } | undefined {
  const incoming = actor.latestSeason;
  if (incoming === undefined) return undefined;
  if (stored?.lastSeenSeasonYear === null || stored?.lastSeenSeason === null) return incoming;
  if (stored === undefined) return incoming;

  const current = { year: stored.lastSeenSeasonYear, season: stored.lastSeenSeason };
  return seasonOrder({ seasonYear: incoming.year, season: incoming.season }) >
    seasonOrder({ seasonYear: current.year, season: current.season })
    ? incoming
    : current;
}

/**
 * 新しい声優の ID と slug。slug を作れない声優 (ローマ字が無い / 記号だけ) は足さない。
 *
 * slug が既に使われていたら staff id を付ける。連番を振らないのは、取り込むたびに
 * 誰が 2 番目になるかが入れ替わり、別人の URL が入れ替わるため (`src/domain/actor-slug.ts`)
 */
function newActorRow(
  actor: AniListActorInput,
  taken: { slugs: ReadonlySet<string>; ids: ReadonlySet<string> },
): { id: string; slug: string; canonicalName: string } | undefined {
  const base = toActorSlug(actor.fullName);
  if (base === undefined) return undefined;

  const candidate = isTaken(base, taken) ? slugWithStaffId(base, actor.anilistStaffId) : base;
  // staff id を付けても埋まっているなら、その行は別人 (同じ staff id なら既存として扱われている)。
  // 連番で逃げると誰がその slug を持つかが取り込みのたびに入れ替わるので、足さずに数える
  if (isTaken(candidate, taken)) return undefined;

  return { id: toActorId(candidate), slug: candidate, canonicalName: actor.nativeName };
}

/** slug と、そこから作る ID のどちらかが既に使われているか */
function isTaken(
  slug: string,
  taken: { slugs: ReadonlySet<string>; ids: ReadonlySet<string> },
): boolean {
  return taken.slugs.has(slug) || taken.ids.has(toActorId(slug));
}

/** 既に居る声優。上書きの前に、後退させたくない値 (最後に見たシーズン) も一緒に読む */
type StoredActor = {
  id: string;
  lastSeenSeasonYear: number | null;
  lastSeenSeason: AnimeSeason | null;
};

async function loadActorsByStaffId(
  db: AppDb,
  staffIds: readonly number[],
): Promise<Map<number, StoredActor>> {
  const found = new Map<number, StoredActor>();
  for (const chunk of chunked([...new Set(staffIds)])) {
    const rows = await db
      .select({
        id: voiceActors.id,
        anilistStaffId: voiceActors.anilistStaffId,
        lastSeenSeasonYear: voiceActors.lastSeenSeasonYear,
        lastSeenSeason: voiceActors.lastSeenSeason,
      })
      .from(voiceActors)
      .where(inArray(voiceActors.anilistStaffId, chunk));
    for (const row of rows) {
      if (row.anilistStaffId === null) continue;
      found.set(row.anilistStaffId, {
        id: row.id,
        lastSeenSeasonYear: row.lastSeenSeasonYear,
        lastSeenSeason: row.lastSeenSeason,
      });
    }
  }
  return found;
}

/**
 * 今ある slug と ID。新しい声優の slug を決める前に読む。
 *
 * ID も見るのは、ID が slug から作られる一方で、シード投入 (`upsertActors`) は両方を
 * 別々に受け取るため。slug だけを見ると、その slug から作った ID が別の行と衝突して
 * 取り込みが途中で落ちる
 */
async function loadTaken(db: AppDb): Promise<{ slugs: Set<string>; ids: Set<string> }> {
  const rows = await db.select({ slug: voiceActors.slug, id: voiceActors.id }).from(voiceActors);
  return {
    slugs: new Set(rows.map((row) => row.slug)),
    ids: new Set(rows.map((row) => row.id)),
  };
}

/** 指定した作品に付いている出演の数 */
async function countAppearances(db: AppDb, animeTitleIds: readonly string[]): Promise<number> {
  let total = 0;
  for (const chunk of chunked([...new Set(animeTitleIds)])) {
    const [row] = await db
      .select({ value: count() })
      .from(animeAppearances)
      .where(inArray(animeAppearances.animeTitleId, chunk));
    total += row?.value ?? 0;
  }
  return total;
}

/**
 * 走行の記録。
 *
 * 1 回の走行は大きすぎて 1 リクエストに収まらないので、シーズンごとに分けて送られてくる。
 * 同じ runId の 2 通目からは件数を足し込む。対象シーズンは範囲で持ち、どの塊も走行全体の
 * 範囲を送るので上書きでよい。
 *
 * 足し込むぶん、同じ塊が送り直されると `anime_count` と `actor_count` が二重に数えられる。
 * 「新規」の 2 つは実際に入った行から数えているので、送り直しでは増えない
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
  // 並び順は送り手に任せず、シーズンの順序で両端を決める。
  // 新しい順に組み立てた走行が来ても、記録の範囲が逆向きにならないようにするため
  const sorted = [...payload.seasons].sort(
    (a, b) =>
      seasonOrder({ seasonYear: a.year, season: a.season }) -
      seasonOrder({ seasonYear: b.year, season: b.season }),
  );
  const from = sorted[0];
  const to = sorted.at(-1);
  // zod が 1 件以上を保証しているので、ここに来る時点で両端は必ずある
  if (from === undefined || to === undefined) return;

  await db
    .insert(anilistIngestRuns)
    .values({
      id: payload.runId,
      startedAt: payload.startedAt,
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
    })
    .onConflictDoUpdate({
      target: anilistIngestRuns.id,
      set: {
        finishedAt: counts.finishedAt,
        seasonFromYear: from.year,
        seasonFrom: from.season,
        seasonToYear: to.year,
        seasonTo: to.season,
        seasonCount: payload.seasons.length,
        animeCount: sql`${anilistIngestRuns.animeCount} + ${counts.animeCount}`,
        actorCount: sql`${anilistIngestRuns.actorCount} + ${payload.actors.length}`,
        newActorCount: sql`${anilistIngestRuns.newActorCount} + ${counts.newActorCount}`,
        newAppearanceCount: sql`${anilistIngestRuns.newAppearanceCount} + ${counts.newAppearanceCount}`,
      },
    });
}
