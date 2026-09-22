import { eq } from "drizzle-orm";
import { INGEST_PROTOCOL_VERSION, type IngestPayload, type RawWork } from "@/domain/types";
import { voiceActors } from "../db/schema";
import { createMigratedTestDb } from "../db/test-db";
import type { AppDb } from "../db/types";
import { writeActorAttributes } from "./actor-attributes";
import { type ActorSeed, upsertActors } from "./actors";
import { upsertAnime } from "./anime";
import { ingest } from "./ingest";

/** テストで使う基準時刻。相対日数の計算をこの時点からにして結果を固定する */
export const NOW = "2026-09-18T00:00:00.000Z";

/**
 * テストで使う声優。かなと表示用ローマ字はシードでは渡せないので (読み取り側が見るのは
 * 付加情報の表と供給元の写しの列)、ここで受け取って `setupDb` が台帳の形で入れる
 */
export type ActorFixture = ActorSeed & { nameKana?: string; nameEn?: string };

export const UEDA: ActorFixture = {
  id: "va_ueda-reina",
  slug: "ueda-reina",
  canonicalName: "上田麗奈",
  nameKana: "うえだれいな",
  anilistStaffId: 100001,
  status: "active",
  gender: "female",
};

export const HANAZAWA: ActorFixture = {
  id: "va_hanazawa-kana",
  slug: "hanazawa-kana",
  canonicalName: "花澤香菜",
  anilistStaffId: 100002,
  status: "active",
  gender: "female",
};

/**
 * マイグレーション済みの空 DB に声優を入れて返す。
 *
 * シードのかなは付加情報の行としても入れる。台帳でかなを持つとはそういうことで、
 * 読み取り側は旧列を見ない (`actor-attributes.ts` の優先順位)
 */
export async function setupDb(actors: ActorFixture[] = [UEDA], now: string = NOW): Promise<AppDb> {
  const db = await createMigratedTestDb();
  if (actors.length === 0) return db;

  await upsertActors(db, actors, now);

  // 表示用ローマ字は供給元の写しの列。本番では AniList の取り込みが入れる
  for (const actor of actors) {
    if (actor.nameEn === undefined) continue;
    await db.update(voiceActors).set({ nameEn: actor.nameEn }).where(eq(voiceActors.id, actor.id));
  }
  const kana = actors.flatMap((actor) =>
    actor.nameKana === undefined
      ? []
      : [
          {
            voiceActorId: actor.id,
            attribute: "nameKana" as const,
            source: "wikipedia" as const,
            value: actor.nameKana,
          },
        ],
  );
  if (kana.length > 0) await writeActorAttributes(db, kana, now);
  return db;
}

/**
 * 指定した声優にそれぞれ作品を 1 件ずつ持たせる。
 *
 * sitemap は作品が 1 件以上ある声優しか返さない。作品数やストアが絡む一覧のテストも、
 * まずここで作品を持たせる
 */
export async function giveEachActorAWork(db: AppDb, actors: ActorFixture[], now: string = NOW) {
  for (const [index, actor] of actors.entries()) {
    await ingest(
      db,
      payload({
        runId: `seed-work-${actor.id}`,
        voiceActorId: actor.id,
        works: [
          rawWork({
            // 作品 ID は声優ごとに変える (同じ ID だと 1 作品を共有した扱いになる)
            storeProductId: `RJ9000000${index}`,
            creditedNames: [actor.canonicalName],
          }),
        ],
      }),
      now,
    );
  }
}

export function rawWork(overrides: Partial<RawWork> = {}): RawWork {
  return {
    storeSlug: "dlsite",
    storeProductId: "RJ01698658",
    titleRaw: "テスト作品",
    productUrl: "https://www.dlsite.com/home/work/=/product_id/RJ01698658.html",
    creditedNames: ["上田麗奈"],
    storeCategory: "SOU",
    ageRating: "general",
    fetchedAt: NOW,
    ...overrides,
  };
}

export function payload(overrides: Partial<IngestPayload> = {}): IngestPayload {
  return {
    protocolVersion: INGEST_PROTOCOL_VERSION,
    runId: "run-1",
    storeSlug: "dlsite",
    voiceActorId: UEDA.id,
    works: [rawWork()],
    ...overrides,
  };
}

/** NOW から指定日数さかのぼった ISO 文字列。期間フィルタのテストで使う */
export function daysAgo(days: number): string {
  return new Date(Date.parse(NOW) - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * 指定した声優をアニメ 1 本に出演させる。
 *
 * 一覧・検索・声優ページは、音声作品が無い声優でも出演アニメがあれば出す。
 * 「音声作品が無くても表に出ること」を確かめたいテストはここで出演を持たせる
 */
export async function giveEachActorAnAnime(db: AppDb, actors: ActorFixture[], now: string = NOW) {
  if (actors.length === 0) return;
  await upsertAnime(
    db,
    [
      {
        id: "anilist:9000001",
        slug: "test-anime",
        titleRomaji: "Test Anime",
        seasonYear: 2026,
        season: "FALL",
        appearances: actors.map((actor, index) => ({
          voiceActorId: actor.id,
          characterId: `anilist:91000${index}`,
          characterNameNative: "テストキャラ",
          role: "main" as const,
        })),
      },
    ],
    now,
  );
}
