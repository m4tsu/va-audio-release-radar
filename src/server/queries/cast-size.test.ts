import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { audioCredits, audioWorks } from "../db/schema";
import type { AppDb } from "../db/types";
import { assignCredit } from "./admin";
import { ingest } from "./ingest";
import { HANAZAWA, NOW, payload, rawWork, setupDb, UEDA } from "./test-fixtures";

/**
 * 作品の行に持たせた出演者数 (`audio_works.cast_size`) が、credit の書き込みに追従すること。
 *
 * 値はトリガーが保つ (`migrations/0023_cast_size_triggers.sql`)。書き込み側のコードはこの列に触れないので、
 * 書き込みの経路を実際に通して列を読む
 */

const WORK_ID = "dlsite:RJ1";

async function castSizeOf(db: AppDb, id = WORK_ID): Promise<number | undefined> {
  const [row] = await db
    .select({ castSize: audioWorks.castSize })
    .from(audioWorks)
    .where(eq(audioWorks.id, id));
  return row?.castSize;
}

describe("出演者数", () => {
  it("名寄せ済みは声優で、未解決は表記で 1 人と数える", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);

    await ingest(
      db,
      payload({
        works: [
          rawWork({ storeProductId: "RJ1", creditedNames: ["上田麗奈", "花澤香菜", "知らない人"] }),
        ],
      }),
      NOW,
    );

    expect(await castSizeOf(db)).toBe(3);
  });

  it("表記違いで同じ声優に解決された credit は 1 人と数える", async () => {
    const db = await setupDb();

    await ingest(
      db,
      payload({
        works: [rawWork({ storeProductId: "RJ1", creditedNames: ["上田麗奈", "上田 麗奈"] })],
      }),
      NOW,
    );

    expect(await castSizeOf(db)).toBe(1);
  });

  it("同じ作品を取り込み直しても数は変わらない", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    const work = rawWork({ storeProductId: "RJ1", creditedNames: ["上田麗奈", "花澤香菜"] });
    await ingest(db, payload({ works: [work] }), NOW);

    await ingest(db, payload({ runId: "run-2", works: [work] }), NOW);

    expect(await castSizeOf(db)).toBe(2);
  });

  /** 未解決の表記を、すでに出ている声優に割り当てると、2 人と数えていたものが 1 人になる */
  it("管理画面で未解決の表記を同じ声優に割り当てると数が減る", async () => {
    const db = await setupDb();
    await ingest(
      db,
      payload({
        works: [rawWork({ storeProductId: "RJ1", creditedNames: ["上田麗奈", "うえだ・れいな"] })],
      }),
      NOW,
    );
    expect(await castSizeOf(db)).toBe(2);

    await assignCredit(db, {
      creditedName: "うえだ・れいな",
      sourceStoreSlug: "dlsite",
      voiceActorId: UEDA.id,
      addAlias: false,
    });

    expect(await castSizeOf(db)).toBe(1);
  });

  it("credit を消すと数が減る", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    await ingest(
      db,
      payload({
        works: [rawWork({ storeProductId: "RJ1", creditedNames: ["上田麗奈", "花澤香菜"] })],
      }),
      NOW,
    );

    await db.delete(audioCredits).where(eq(audioCredits.voiceActorId, HANAZAWA.id));

    expect(await castSizeOf(db)).toBe(1);
  });

  /** 表を丸ごと流し込むときは、外部キーを止めて子の表を先に入れることがある */
  it("credit を作品より先に入れても、作品を入れた時点で数が揃う", async () => {
    const db = await setupDb();
    await db.run(sql`pragma foreign_keys = off`);
    await db.insert(audioCredits).values({
      audioWorkId: WORK_ID,
      voiceActorId: UEDA.id,
      creditedName: UEDA.canonicalName,
      confidence: "verified",
      sourceStoreSlug: "dlsite",
    });

    await db.insert(audioWorks).values({
      id: WORK_ID,
      title: "作品",
      category: "audio_drama",
      ageRating: "general",
      createdAt: NOW,
      updatedAt: NOW,
    });

    expect(await castSizeOf(db)).toBe(1);
  });
});
