import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { INGEST_PROTOCOL_VERSION } from "@/domain/types";
import { anilistIngestRuns, voiceActorAttributes, voiceActors } from "../db/schema";
import { createMigratedTestDb } from "../db/test-db";
import type { AppDb } from "../db/types";
import { writeActorAttributes } from "./actor-attributes";
import { getActorBySlug, upsertActors } from "./actors";
import { type AniListIngestPayload, ingestAniList } from "./anilist";
import { getAnimeBySlug } from "./anime";
import { recordScreened, screenedStoreProductIds } from "./screened";
import { NOW } from "./test-fixtures";

/**
 * AniList からの取り込み。台帳は足すだけで、同一性と付加情報を動かさないことを見る。
 *
 * 取り込みを 2 回流す形のテストが多いのは、この経路の要が冪等性だから。
 * 週次で同じシーズンを取り直すので、2 回目が 1 回目の結果を壊さないことが振る舞いの本体になる
 */

const UEDA_STAFF_ID = 118602;

function actor(overrides: Partial<AniListIngestPayload["actors"][number]> = {}) {
  return {
    anilistStaffId: UEDA_STAFF_ID,
    nativeName: "上田麗奈",
    fullName: "Reina Ueda",
    gender: "female" as const,
    imageUrl: "https://example.test/ueda.png",
    latestSeason: { year: 2026, season: "FALL" as const },
    ...overrides,
  };
}

function anime(overrides: Partial<AniListIngestPayload["anime"][number]> = {}) {
  return {
    id: "anilist:1",
    slug: "test-anime",
    titleNative: "テストアニメ",
    titleRomaji: "Test Anime",
    seasonYear: 2026,
    season: "FALL" as const,
    appearances: [
      {
        anilistStaffId: UEDA_STAFF_ID,
        characterId: "anilist:c1",
        characterNameNative: "テストキャラ",
        role: "main" as const,
      },
    ],
    ...overrides,
  };
}

function payload(overrides: Partial<AniListIngestPayload> = {}): AniListIngestPayload {
  return {
    protocolVersion: INGEST_PROTOCOL_VERSION,
    runId: "anilist-run-1",
    startedAt: NOW,
    seasons: [
      { year: 2024, season: "WINTER" },
      { year: 2026, season: "FALL" },
    ],
    actors: [actor()],
    anime: [anime()],
    ...overrides,
  };
}

async function emptyDb(): Promise<AppDb> {
  return createMigratedTestDb();
}

describe("初めて見る声優", () => {
  it("ローマ字から slug を作って行を足す", async () => {
    const db = await emptyDb();

    const result = await ingestAniList(db, payload(), NOW);

    expect(result.newActors).toEqual([
      {
        id: "va_ueda-reina",
        slug: "ueda-reina",
        canonicalName: "上田麗奈",
        anilistStaffId: UEDA_STAFF_ID,
      },
    ]);
    expect(await getActorBySlug(db, "ueda-reina")).toMatchObject({
      canonicalName: "上田麗奈",
      nameEn: "Reina Ueda",
      gender: "female",
    });
  });

  it("同じ取得結果を 2 回送っても同じ 1 行のまま、2 回目は新規ゼロ", async () => {
    const db = await emptyDb();
    await ingestAniList(db, payload(), NOW);

    const second = await ingestAniList(db, payload(), "2026-09-29T00:00:00.000Z");

    expect(second.newActors).toEqual([]);
    expect(await db.select().from(voiceActors)).toHaveLength(1);
  });

  it("ローマ字が同じ別人には staff id を付けた slug を与える", async () => {
    const db = await emptyDb();
    await ingestAniList(db, payload({ actors: [actor()], anime: [] }), NOW);

    const result = await ingestAniList(
      db,
      payload({
        runId: "anilist-run-2",
        actors: [actor({ anilistStaffId: 999, nativeName: "植田怜奈" })],
        anime: [],
      }),
      NOW,
    );

    expect(result.newActors[0]).toMatchObject({
      slug: `ueda-reina-999`,
      canonicalName: "植田怜奈",
    });
    // 先に居た人の slug は動かない。動かすと公開済みの URL が別人を指す
    expect((await getActorBySlug(db, "ueda-reina"))?.canonicalName).toBe("上田麗奈");
  });

  it("ローマ字が無くて slug を作れない声優は足さずに数える", async () => {
    const db = await emptyDb();

    const result = await ingestAniList(
      db,
      payload({ actors: [actor({ fullName: undefined })], anime: [] }),
      NOW,
    );

    expect(result).toMatchObject({ newActors: [], skippedActors: 1 });
    expect(await db.select().from(voiceActors)).toHaveLength(0);
  });
});

describe("既に居る声優", () => {
  it("供給元の写しは上書きし、同一性は動かさない", async () => {
    const db = await emptyDb();
    await upsertActors(
      db,
      [
        {
          id: "va_seed-id",
          slug: "seed-slug",
          canonicalName: "旧表記",
          anilistStaffId: UEDA_STAFF_ID,
          status: "active",
          gender: "unknown",
        },
      ],
      NOW,
    );

    await ingestAniList(db, payload({ anime: [] }), "2026-09-29T00:00:00.000Z");

    const [row] = await db
      .select()
      .from(voiceActors)
      .where(eq(voiceActors.anilistStaffId, UEDA_STAFF_ID));
    expect(row).toMatchObject({
      // 同一性
      id: "va_seed-id",
      slug: "seed-slug",
      firstSeenAt: NOW,
      // 供給元の写し
      canonicalName: "上田麗奈",
      nameEn: "Reina Ueda",
      gender: "female",
      lastSeenSeasonYear: 2026,
      lastSeenSeason: "FALL",
    });
  });

  it("付加情報と別名義は取り込みで変わらない", async () => {
    const db = await emptyDb();
    await ingestAniList(db, payload({ anime: [] }), NOW);
    await writeActorAttributes(
      db,
      [
        {
          voiceActorId: "va_ueda-reina",
          attribute: "nameKana",
          source: "editorial",
          value: "うえだれいな",
        },
      ],
      NOW,
    );

    await ingestAniList(
      db,
      payload({ runId: "anilist-run-2", anime: [] }),
      "2026-09-29T00:00:00.000Z",
    );

    const attributes = await db.select().from(voiceActorAttributes);
    expect(attributes).toHaveLength(1);
    expect(attributes[0]).toMatchObject({ value: "うえだれいな", recordedAt: NOW });
  });
});

describe("作品と出演", () => {
  it("staff id の出演を声優 ID に置き換えて保存する", async () => {
    const db = await emptyDb();

    const result = await ingestAniList(db, payload(), NOW);

    expect(result).toMatchObject({ anime: 1, newAppearances: 1 });
    const saved = await getAnimeBySlug(db, "test-anime");
    expect(saved?.cast.map((member) => member.actor.id)).toEqual(["va_ueda-reina"]);
  });

  it("今回送らなかった作品と出演は消えない", async () => {
    const db = await emptyDb();
    await ingestAniList(db, payload(), NOW);

    await ingestAniList(
      db,
      payload({
        runId: "anilist-run-2",
        anime: [anime({ id: "anilist:2", slug: "another-anime", titleRomaji: "Another Anime" })],
      }),
      NOW,
    );

    expect(await getAnimeBySlug(db, "test-anime")).toBeDefined();
    expect(await getAnimeBySlug(db, "another-anime")).toBeDefined();
  });

  it("2 回目の取り込みでは増えた出演を 0 と数える", async () => {
    const db = await emptyDb();
    await ingestAniList(db, payload(), NOW);

    const second = await ingestAniList(db, payload({ runId: "anilist-run-2" }), NOW);

    expect(second.newAppearances).toBe(0);
  });

  it("足せなかった声優だけの作品は保存しない", async () => {
    const db = await emptyDb();

    const result = await ingestAniList(
      db,
      payload({ actors: [actor({ fullName: undefined })] }),
      NOW,
    );

    expect(result.anime).toBe(0);
    expect(await getAnimeBySlug(db, "test-anime")).toBeUndefined();
  });
});

describe("取り込みの記録", () => {
  it("対象シーズンの範囲と増えた数を 1 行に残す", async () => {
    const db = await emptyDb();

    await ingestAniList(db, payload(), NOW);

    const [run] = await db.select().from(anilistIngestRuns);
    expect(run).toMatchObject({
      id: "anilist-run-1",
      startedAt: NOW,
      seasonFromYear: 2024,
      seasonFrom: "WINTER",
      seasonToYear: 2026,
      seasonTo: "FALL",
      seasonCount: 2,
      animeCount: 1,
      actorCount: 1,
      newActorCount: 1,
      newAppearanceCount: 1,
    });
  });

  it("同じ runId で送り直しても記録は 1 行のまま", async () => {
    const db = await emptyDb();
    await ingestAniList(db, payload(), NOW);

    await ingestAniList(db, payload(), "2026-09-29T00:00:00.000Z");

    const runs = await db.select().from(anilistIngestRuns);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ newActorCount: 0, finishedAt: "2026-09-29T00:00:00.000Z" });
  });
});

describe("声優が増えたとき", () => {
  it("過去の「対象声優が居ない」の判断を捨てる", async () => {
    const db = await emptyDb();
    await recordScreened(db, "dlsite", ["RJ111"], NOW);

    await ingestAniList(db, payload({ anime: [] }), NOW);

    expect(await screenedStoreProductIds(db, "dlsite")).toEqual([]);
  });

  it("増えなければ捨てない", async () => {
    const db = await emptyDb();
    await ingestAniList(db, payload({ anime: [] }), NOW);
    await recordScreened(db, "dlsite", ["RJ111"], NOW);

    await ingestAniList(db, payload({ runId: "anilist-run-2", anime: [] }), NOW);

    expect(await screenedStoreProductIds(db, "dlsite")).toEqual(["RJ111"]);
  });
});
