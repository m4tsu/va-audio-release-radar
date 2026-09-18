import type { IngestPayload, RawWork } from "@/domain/types";
import { createMigratedTestDb } from "../db/test-db";
import type { AppDb } from "../db/types";
import { type ActorSeed, upsertActors } from "./actors";

/** テストで使う基準時刻。相対日数の計算をこの時点からにして結果を固定する */
export const NOW = "2026-09-18T00:00:00.000Z";

export const UEDA: ActorSeed = {
  id: "va_ueda-reina",
  slug: "ueda-reina",
  canonicalName: "上田麗奈",
  nameKana: "うえだれいな",
  status: "active",
};

export const HANAZAWA: ActorSeed = {
  id: "va_hanazawa-kana",
  slug: "hanazawa-kana",
  canonicalName: "花澤香菜",
  status: "active",
};

/** マイグレーション済みの空 DB に声優を入れて返す */
export async function setupDb(actors: ActorSeed[] = [UEDA], now: string = NOW): Promise<AppDb> {
  const db = await createMigratedTestDb();
  if (actors.length > 0) await upsertActors(db, actors, now);
  return db;
}

export function rawWork(overrides: Partial<RawWork> = {}): RawWork {
  return {
    storeSlug: "dlsite",
    storeProductId: "RJ01698658",
    titleRaw: "テスト作品",
    productUrl: "https://www.dlsite.com/home/work/=/product_id/RJ01698658.html",
    creditedNames: ["上田麗奈"],
    storeCategory: "SOU",
    adult: false,
    fetchedAt: NOW,
    ...overrides,
  };
}

export function payload(overrides: Partial<IngestPayload> = {}): IngestPayload {
  return {
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
