import { type AniListIngestPayload, INGEST_PROTOCOL_VERSION } from "../../src/contract/index.ts";
import { type SeasonCredit, type SeasonKey, type SeasonMedia, seasonOrder } from "./anilist.ts";
import {
  type AnimeSlugCollision,
  findAnimeSlugCollisions,
  toAnimeRole,
  toAnimeSlug,
} from "./anime-entity.ts";

/**
 * AniList の取得結果を、取り込み API に送る形にする純粋関数。
 *
 * ここは fetch も fs も触らない。声優の ID と slug は決めない (決めるのは Worker 側で、
 * slug の衝突は今ある全員と突き合わせないと解けないため)。送るのは AniList が言った値だけ。
 *
 * **同じ日本語表記の別人を落とさない。** 名前でストアと突き合わせるときに誰の作品か
 * 断定できないのは変わらないが、それは取り込み側の照合が「複数に当たったら unmatched」で
 * 断っている (`src/domain/identity.ts`)。台帳から人を落とす理由にはしない
 */

export type AniListPayloadInput = {
  runId: string;
  startedAt: string;
  seasons: readonly SeasonKey[];
  media: readonly SeasonMedia[];
  credits: readonly SeasonCredit[];
};

/** 作品を送らなかった理由。ローマ字が無いと URL を作れない */
export type AnimeExclusion = { mediaId: number; titleNative?: string };

export type AniListPayloadResult = {
  payload: AniListIngestPayload;
  /** slug を作れず送らなかった作品 */
  excludedAnime: AnimeExclusion[];
  /** 同じ slug になった作品。人が決めるまで自動で連番を振らない */
  collisions: AnimeSlugCollision[];
  /** 日本語表記が無く送らなかった出演者の数 */
  actorsWithoutNativeName: number;
};

/**
 * シーズンごとに分けて組み立てる。取り込みは 1 リクエストで送れる大きさに収める必要があり、
 * 1 回の走行ぶん (12 シーズン) をまとめると作品 1,000 件・出演 数万件になって、
 * 取り込み先が応答する前にクライアントが諦める。
 *
 * シーズンで割るのは、出演がその作品の声優を指すので、作品と声優を同じ塊に入れないと
 * 取り込み側で引き当てられないため。シーズンで割れば塊の中で必ず揃う
 */
export function buildAniListPayloadsBySeason(input: AniListPayloadInput): AniListPayloadResult[] {
  return input.seasons.map((season) => {
    const media = input.media.filter(
      (item) => item.season.year === season.year && item.season.season === season.season,
    );
    const mediaIds = new Set(media.map((item) => item.id));
    return buildAniListPayload({
      ...input,
      // 送る記録には走行全体のシーズン範囲を載せる。塊ごとに範囲が変わると記録が読めない
      media,
      credits: input.credits.filter((credit) => mediaIds.has(credit.mediaId)),
    });
  });
}

export function buildAniListPayload(input: AniListPayloadInput): AniListPayloadResult {
  const { actors, actorsWithoutNativeName } = buildActors(input.credits);
  // 送らない声優を指す出演は組み立てない。送ると取り込み側が引き当てに失敗して落とすので、
  // 「送る側の組み立て漏れ」と「元から送らないと決めた人」が同じ警告に混ざる
  const sentStaffIds = new Set(actors.map((actor) => actor.anilistStaffId));
  const { anime, excludedAnime } = buildAnime(input.media, input.credits, sentStaffIds);

  return {
    payload: {
      protocolVersion: INGEST_PROTOCOL_VERSION,
      runId: input.runId,
      startedAt: input.startedAt,
      seasons: input.seasons.map((season) => ({ year: season.year, season: season.season })),
      actors,
      anime,
    },
    excludedAnime,
    collisions: findAnimeSlugCollisions(anime),
    actorsWithoutNativeName,
  };
}

/**
 * 出演から声優を集める。
 *
 * 名前・ローマ字・性別は最初に見た値を採る。同じ声優の credit は同じ値を持つので、
 * 言っていない credit で上書きしないためにこの順にする。
 * 最後に見たシーズンは、この取得で一番新しいものを採る
 */
function buildActors(credits: readonly SeasonCredit[]): {
  actors: AniListIngestPayload["actors"];
  actorsWithoutNativeName: number;
} {
  type Accumulator = {
    anilistStaffId: number;
    nativeName?: string;
    fullName?: string;
    gender?: SeasonCredit["gender"];
    imageUrl?: string;
    latestSeason?: SeasonKey;
  };

  const byStaffId = new Map<number, Accumulator>();
  for (const credit of credits) {
    const accumulator = byStaffId.get(credit.staffId) ?? { anilistStaffId: credit.staffId };
    accumulator.nativeName ??= credit.nativeName;
    accumulator.fullName ??= credit.fullName;
    accumulator.gender ??= credit.gender;
    accumulator.imageUrl ??= credit.actorImageUrl;
    if (
      accumulator.latestSeason === undefined ||
      seasonOrder(credit.season) > seasonOrder(accumulator.latestSeason)
    ) {
      accumulator.latestSeason = credit.season;
    }
    byStaffId.set(credit.staffId, accumulator);
  }

  const actors: AniListIngestPayload["actors"] = [];
  let actorsWithoutNativeName = 0;
  for (const accumulator of byStaffId.values()) {
    const nativeName = accumulator.nativeName?.trim();
    // 名前はストアとの突き合わせに使う唯一の鍵。無い人は送っても照合に出てこない
    if (nativeName === undefined || nativeName === "") {
      actorsWithoutNativeName += 1;
      continue;
    }
    actors.push({
      anilistStaffId: accumulator.anilistStaffId,
      nativeName,
      ...(accumulator.fullName === undefined ? {} : { fullName: accumulator.fullName }),
      ...(accumulator.gender === undefined ? {} : { gender: accumulator.gender }),
      ...(accumulator.imageUrl === undefined ? {} : { imageUrl: accumulator.imageUrl }),
      ...(accumulator.latestSeason === undefined
        ? {}
        : {
            latestSeason: {
              year: accumulator.latestSeason.year,
              season: accumulator.latestSeason.season,
            },
          }),
    });
  }
  return { actors, actorsWithoutNativeName };
}

/** 作品と出演。出演は声優の ID ではなく staff id で指す (ID を決めるのは Worker 側) */
function buildAnime(
  media: readonly SeasonMedia[],
  credits: readonly SeasonCredit[],
  sentStaffIds: ReadonlySet<number>,
): { anime: AniListIngestPayload["anime"]; excludedAnime: AnimeExclusion[] } {
  type Appearances = AniListIngestPayload["anime"][number]["appearances"];
  const appearancesByMediaId = new Map<number, Appearances>();
  const seenKeys = new Set<string>();

  for (const credit of credits) {
    const role = toAnimeRole(credit.role);
    // 端役 (BACKGROUND) は出演として保存しない。声優そのものは上の `buildActors` が拾う
    if (role === undefined) continue;
    // 日本語表記が無くて送らない声優の出演は、指す先が無いので組み立てない
    if (!sentStaffIds.has(credit.staffId)) continue;
    const key = `${credit.mediaId}:${credit.characterId}:${credit.staffId}`;
    // 同じ出演が複数ページ・複数シーズンから入ることがあるので、一意キーで畳む
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const list = appearancesByMediaId.get(credit.mediaId) ?? [];
    list.push({
      anilistStaffId: credit.staffId,
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

  const anime: AniListIngestPayload["anime"] = [];
  const excludedAnime: AnimeExclusion[] = [];
  const seenMediaIds = new Set<number>();

  for (const item of media) {
    if (seenMediaIds.has(item.id)) continue;
    seenMediaIds.add(item.id);

    const titleRomaji = item.titleRomaji;
    const slug = toAnimeSlug(titleRomaji);
    if (titleRomaji === undefined || slug === undefined) {
      excludedAnime.push({
        mediaId: item.id,
        ...(item.titleNative === undefined ? {} : { titleNative: item.titleNative }),
      });
      continue;
    }
    const appearances = appearancesByMediaId.get(item.id) ?? [];
    // 出演が 1 件も無い作品は送らない。取り込み側が 1 件以上を要求する
    if (appearances.length === 0) continue;

    anime.push({
      id: `anilist:${item.id}`,
      slug,
      ...(item.titleNative === undefined ? {} : { titleNative: item.titleNative }),
      titleRomaji,
      ...(item.titleEnglish === undefined ? {} : { titleEnglish: item.titleEnglish }),
      ...(item.synonyms === undefined || item.synonyms.length === 0
        ? {}
        : { synonyms: item.synonyms }),
      ...(item.format === undefined ? {} : { format: item.format }),
      ...(item.popularity === undefined ? {} : { popularity: item.popularity }),
      ...(item.startDate === undefined ? {} : { startDate: item.startDate }),
      ...(item.endDate === undefined ? {} : { endDate: item.endDate }),
      seasonYear: item.season.year,
      season: item.season.season,
      ...(item.coverImageUrl === undefined ? {} : { coverImageUrl: item.coverImageUrl }),
      ...(item.coverImageColor === undefined ? {} : { coverImageColor: item.coverImageColor }),
      appearances,
    });
  }

  return { anime, excludedAnime };
}
