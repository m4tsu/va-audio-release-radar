import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { animeTitles, audioCredits, audioWorks, storeListings, voiceActors } from "../db/schema";
import type { AppDb } from "../db/types";
import { assignCredit } from "./admin";
import { recordDelistings } from "./delistings";
import { ingest } from "./ingest";
import {
  giveEachActorAnAnime,
  HANAZAWA,
  NOW,
  payload,
  rawWork,
  setupDb,
  UEDA,
} from "./test-fixtures";
import { notAdultRated, onSaleSomewhere } from "./works";

/**
 * 声優とアニメの行に持たせた「買える作品の数」が、書き込みのたびに追従すること。
 *
 * 値はトリガーが保つ (`migrations/0020_on_sale_counts_triggers.sql`)。書き込み側のコードは
 * この列に触れないので、ここでは書き込みの経路を実際に通して列を読む
 */

const LATER = "2026-09-29T00:00:00.000Z";
const ANIME_ID = "anilist:9000001";

async function actorCounts(db: AppDb, id: string) {
  const [row] = await db
    .select({ count: voiceActors.onSaleWorkCount, stores: voiceActors.onSaleStoreSlugs })
    .from(voiceActors)
    .where(eq(voiceActors.id, id));
  return row;
}

async function animeActorCount(db: AppDb): Promise<number | undefined> {
  const [row] = await db
    .select({ count: animeTitles.onSaleActorCount })
    .from(animeTitles)
    .where(eq(animeTitles.id, ANIME_ID));
  return row?.count;
}

describe("買える作品の数", () => {
  it("取り込んだ作品を数え、載っているストアを並べる", async () => {
    const db = await setupDb();

    await ingest(db, payload(), NOW);
    await ingest(
      db,
      payload({
        runId: "run-2",
        storeSlug: "audible",
        works: [
          rawWork({
            storeSlug: "audible",
            storeProductId: "B0TEST0001",
            titleRaw: "別の作品",
            productUrl: "https://www.audible.co.jp/pd/B0TEST0001",
          }),
        ],
      }),
      NOW,
    );

    const counts = await actorCounts(db, UEDA.id);
    expect(counts?.count).toBe(2);
    expect(counts?.stores?.split(",").sort()).toEqual(["audible", "dlsite"]);
  });

  it("作品が無い声優は 0 で、ストアを持たない", async () => {
    const db = await setupDb();

    expect(await actorCounts(db, UEDA.id)).toEqual({ count: 0, stores: null });
  });

  it("取り下げると数から外れ、取り消すと戻る", async () => {
    const db = await setupDb();
    await ingest(db, payload(), NOW);

    await recordDelistings(
      db,
      [{ storeSlug: "dlsite", storeProductId: "RJ01698658", delisted: true }],
      LATER,
    );
    expect(await actorCounts(db, UEDA.id)).toEqual({ count: 0, stores: null });

    await recordDelistings(
      db,
      [{ storeSlug: "dlsite", storeProductId: "RJ01698658", delisted: false }],
      LATER,
    );
    expect((await actorCounts(db, UEDA.id))?.count).toBe(1);
  });

  it("名寄せできなかった credit を管理画面で割り当てると数に入る", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    await ingest(db, payload({ works: [rawWork({ creditedNames: ["はなざわ・かな"] })] }), NOW);
    expect((await actorCounts(db, HANAZAWA.id))?.count).toBe(0);

    await assignCredit(db, {
      creditedName: "はなざわ・かな",
      sourceStoreSlug: "dlsite",
      voiceActorId: HANAZAWA.id,
      addAlias: false,
    });

    expect((await actorCounts(db, HANAZAWA.id))?.count).toBe(1);
  });

  /** 表を丸ごと流し込むときは、外部キーを止めて子の表を先に入れることがある */
  it("credit と listing を作品より先に入れても、作品を入れた時点で数が揃う", async () => {
    const db = await setupDb();
    await db.run(sql`pragma foreign_keys = off`);

    await db.insert(audioCredits).values({
      audioWorkId: "dlsite:RJ1",
      voiceActorId: UEDA.id,
      creditedName: UEDA.canonicalName,
      confidence: "verified",
      sourceStoreSlug: "dlsite",
    });
    await db.insert(storeListings).values({
      audioWorkId: "dlsite:RJ1",
      storeSlug: "dlsite",
      storeProductId: "RJ1",
      productUrl: "https://www.dlsite.com/home/work/=/product_id/RJ1.html",
      titleRaw: "作品",
      firstSeenAt: NOW,
      lastSeenAt: NOW,
      lastCheckedAt: NOW,
    });
    expect((await actorCounts(db, UEDA.id))?.count).toBe(0);

    await db.insert(audioWorks).values({
      id: "dlsite:RJ1",
      title: "作品",
      category: "audio_drama",
      ageRating: "general",
      createdAt: NOW,
      updatedAt: NOW,
    });

    expect(await actorCounts(db, UEDA.id)).toEqual({ count: 1, stores: "dlsite" });
  });

  it("アニメは買える作品を持つ出演者だけを数える", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    await ingest(db, payload(), NOW);

    await giveEachActorAnAnime(db, [UEDA, HANAZAWA]);

    expect(await animeActorCount(db)).toBe(1);
  });

  it("出演者の作品が増減すると、アニメの数も追従する", async () => {
    const db = await setupDb();
    await giveEachActorAnAnime(db, [UEDA]);
    expect(await animeActorCount(db)).toBe(0);

    await ingest(db, payload(), NOW);
    expect(await animeActorCount(db)).toBe(1);

    await recordDelistings(
      db,
      [{ storeSlug: "dlsite", storeProductId: "RJ01698658", delisted: true }],
      LATER,
    );
    expect(await animeActorCount(db)).toBe(0);
  });
});

describe("トリガーの数え方と画面の絞り込みの一致", () => {
  async function countByQuery(db: AppDb, voiceActorId: string): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`count(distinct ${audioWorks.id})` })
      .from(audioCredits)
      .innerJoin(audioWorks, eq(audioWorks.id, audioCredits.audioWorkId))
      .where(and(eq(audioCredits.voiceActorId, voiceActorId), notAdultRated, onSaleSomewhere));
    return Number(row?.count ?? 0);
  }

  it("取り下げと成人向けが混ざっても、列の数は notAdultRated と onSaleSomewhere で数えた数と同じ", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    const work = (storeProductId: string, creditedNames: string[]) =>
      rawWork({
        storeProductId,
        creditedNames,
        productUrl: `https://www.dlsite.com/home/work/=/product_id/${storeProductId}.html`,
      });
    await ingest(
      db,
      payload({
        works: [
          work("RJ01000001", [UEDA.canonicalName]),
          work("RJ01000002", [UEDA.canonicalName, HANAZAWA.canonicalName]),
          work("RJ01000003", [HANAZAWA.canonicalName]),
          work("RJ01000004", [UEDA.canonicalName]),
        ],
      }),
      NOW,
    );
    await recordDelistings(
      db,
      [{ storeSlug: "dlsite", storeProductId: "RJ01000002", delisted: true }],
      LATER,
    );
    await db
      .update(audioWorks)
      .set({ ageRating: "r18" })
      .where(eq(audioWorks.id, "dlsite:RJ01000004"));

    for (const actor of [UEDA, HANAZAWA]) {
      expect((await actorCounts(db, actor.id))?.count).toBe(await countByQuery(db, actor.id));
    }
  });
});
