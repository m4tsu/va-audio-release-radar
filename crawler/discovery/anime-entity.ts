import type { AniListSeason } from "./anilist.ts";

/**
 * AniList の作品と出演から「今期アニメからの入口」のエンティティを組み立てる純粋関数
 * (設計 `docs/feature-proposals/anime-season-entry-design-2026-09-18.md` §4)。
 *
 * ここは fetch も fs も触らない。CLI 側 (`run.ts`) が読み書きを持ち、規則そのものはここに閉じる。
 * slug は URL に出て後から変えられないので、規則を単体テストで固定しておく必要がある
 * (`actor-entity.ts` と同じ方針)
 */

/** `crawlAniList` が返す作品のうち、エンティティ生成に要る項目だけ */
export type AnimeMediaInput = {
  id: number;
  season: { year: number; season: AniListSeason };
  titleNative?: string;
  titleRomaji?: string;
  titleEnglish?: string;
  coverImageUrl?: string;
};

/** `anilist-credits.json` の 1 件のうち、エンティティ生成に要る項目だけ */
export type AnimeCreditInput = {
  mediaId: number;
  staffId: number;
  characterId: number;
  characterNameNative?: string;
  characterNameFull?: string;
  characterImageUrl?: string;
  /** "MAIN" | "SUPPORTING" | "BACKGROUND" など */
  role?: string;
};

/** `actors.generated.json` のうち、AniList の staff と突き合わせるのに要る項目だけ */
export type TargetActorInput = { id: string; anilistStaffId: number };

export type AnimeRole = "main" | "supporting";

export type AnimeAppearance = {
  voiceActorId: string;
  characterId: string;
  characterNameNative?: string;
  characterNameFull?: string;
  characterImageUrl?: string;
  role: AnimeRole;
};

export type AnimeEntity = {
  id: string;
  slug: string;
  titleNative?: string;
  titleRomaji: string;
  titleEnglish?: string;
  seasonYear: number;
  season: AniListSeason;
  coverImageUrl?: string;
  appearances: AnimeAppearance[];
};

export type AnimeExclusionReason =
  /** `titleRomaji` が無い、または記号だけで slug を作れない */
  | "no-slug"
  /** 対象声優が 1 人も出ていない */
  | "no-appearance";

export type AnimeExclusion = {
  mediaId: number;
  titleNative?: string;
  titleRomaji?: string;
  reason: AnimeExclusionReason;
};

/** 同じ slug になった 2 作品以上。生成を失敗させて人に判断させるための材料 */
export type AnimeSlugCollision = {
  slug: string;
  members: Array<{ id: string; titleRomaji: string }>;
};

export type AnimeBuildResult = {
  anime: AnimeEntity[];
  excluded: AnimeExclusion[];
  collisions: AnimeSlugCollision[];
};

// --- slug ------------------------------------------------------------------

/**
 * ローマ字タイトル ("Sousou no Frieren") を slug ("sousou-no-frieren") にする。
 *
 * 英数字以外はすべて区切りとして扱う。コロンや中黒 ("Made in Abyss: Mezameru Shinpi") が
 * URL に出ると読みにくく、エスケープの有無で同じページが二重に見えるため。
 * 記号だけで中身が残らない場合は undefined を返す
 */
export function toAnimeSlug(titleRomaji: string | undefined): string | undefined {
  if (titleRomaji === undefined) return undefined;
  const slug = titleRomaji
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? undefined : slug;
}

// --- 役 --------------------------------------------------------------------

/**
 * AniList の role を保存する値にする。
 *
 * MAIN / SUPPORTING 以外 (BACKGROUND など) は undefined を返し、出演そのものを捨てる。
 * 名前のあるキャラクターを演じたとは限らず、画面に出す価値が無いため
 */
export function toAnimeRole(role: string | undefined): AnimeRole | undefined {
  switch (role) {
    case "MAIN":
      return "main";
    case "SUPPORTING":
      return "supporting";
    default:
      return undefined;
  }
}

// --- 組み立て --------------------------------------------------------------

/** (作品, キャラクター, 声優) の一意キー。1 人が 1 作品で複数キャラを演じることがある */
function appearanceKey(mediaId: number, characterId: number, voiceActorId: string): string {
  return `${mediaId}/${characterId}/${voiceActorId}`;
}

/**
 * 作品と出演をエンティティにする。
 *
 * `targetActors` に居る声優の出演だけを入れる。全キャストを保存すると AniList の
 * Hoarding 禁止 (設計 §2) に触れ、「アニメのキャスト DB ではない」という製品の線
 * (`docs/design/architecture.md` §1) も越えるため。対象声優が 0 人になった作品は出力しない
 */
export function buildAnimeEntities(
  media: readonly AnimeMediaInput[],
  credits: readonly AnimeCreditInput[],
  targetActors: readonly TargetActorInput[],
): AnimeBuildResult {
  const actorIdByStaffId = new Map<number, string>();
  for (const actor of targetActors) actorIdByStaffId.set(actor.anilistStaffId, actor.id);

  const appearancesByMediaId = new Map<number, AnimeAppearance[]>();
  const seenKeys = new Set<string>();
  for (const credit of credits) {
    const voiceActorId = actorIdByStaffId.get(credit.staffId);
    if (voiceActorId === undefined) continue;
    const role = toAnimeRole(credit.role);
    if (role === undefined) continue;
    const key = appearanceKey(credit.mediaId, credit.characterId, voiceActorId);
    // 同じ出演が複数ページ・複数シーズンから入ることがあるので、一意キーで畳む
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const list = appearancesByMediaId.get(credit.mediaId) ?? [];
    list.push({
      voiceActorId,
      characterId: `anilist:${credit.characterId}`,
      ...(credit.characterNameNative === undefined
        ? {}
        : { characterNameNative: credit.characterNameNative }),
      ...(credit.characterNameFull === undefined
        ? {}
        : { characterNameFull: credit.characterNameFull }),
      ...(credit.characterImageUrl === undefined
        ? {}
        : { characterImageUrl: credit.characterImageUrl }),
      role,
    });
    appearancesByMediaId.set(credit.mediaId, list);
  }

  const anime: AnimeEntity[] = [];
  const excluded: AnimeExclusion[] = [];
  const seenMediaIds = new Set<number>();
  for (const item of media) {
    if (seenMediaIds.has(item.id)) continue;
    seenMediaIds.add(item.id);

    const base = {
      mediaId: item.id,
      ...(item.titleNative === undefined ? {} : { titleNative: item.titleNative }),
      ...(item.titleRomaji === undefined ? {} : { titleRomaji: item.titleRomaji }),
    };
    const titleRomaji = item.titleRomaji;
    const slug = toAnimeSlug(titleRomaji);
    if (titleRomaji === undefined || slug === undefined) {
      excluded.push({ ...base, reason: "no-slug" });
      continue;
    }
    const appearances = appearancesByMediaId.get(item.id) ?? [];
    if (appearances.length === 0) {
      excluded.push({ ...base, reason: "no-appearance" });
      continue;
    }

    anime.push({
      id: `anilist:${item.id}`,
      slug,
      ...(item.titleNative === undefined ? {} : { titleNative: item.titleNative }),
      titleRomaji,
      ...(item.titleEnglish === undefined ? {} : { titleEnglish: item.titleEnglish }),
      seasonYear: item.season.year,
      season: item.season.season,
      ...(item.coverImageUrl === undefined ? {} : { coverImageUrl: item.coverImageUrl }),
      appearances,
    });
  }

  return { anime, excluded, collisions: findAnimeSlugCollisions(anime) };
}

/**
 * 同じ slug になった作品を集める。
 *
 * 見つかっても `-2` のような連番は振らない。どちらが `/anime/{slug}` なのかが
 * 実行のたびに入れ替わり、別作品の出演者が混ざる。どちらを正とするかは人が決める
 * (声優 slug と同じ方針。`docs/design/architecture.md` §2)
 */
export function findAnimeSlugCollisions(anime: readonly AnimeEntity[]): AnimeSlugCollision[] {
  const bySlug = new Map<string, AnimeEntity[]>();
  for (const item of anime) {
    const group = bySlug.get(item.slug);
    if (group) group.push(item);
    else bySlug.set(item.slug, [item]);
  }

  const collisions: AnimeSlugCollision[] = [];
  for (const [slug, group] of bySlug) {
    if (group.length < 2) continue;
    collisions.push({
      slug,
      members: group.map((item) => ({ id: item.id, titleRomaji: item.titleRomaji })),
    });
  }
  return collisions;
}

/** 除外理由を人が読む 1 行にする */
export function describeAnimeExclusionReason(reason: AnimeExclusionReason): string {
  switch (reason) {
    case "no-slug":
      return "titleRomaji が無く slug を作れない";
    case "no-appearance":
      return "対象声優が 1 人も出ていない";
  }
}
