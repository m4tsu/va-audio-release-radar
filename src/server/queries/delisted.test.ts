import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { storeListings } from "../db/schema";
import type { AppDb } from "../db/types";
import { ingest } from "./ingest";
import { NOW, payload, rawWork, setupDb, UEDA } from "./test-fixtures";
import { getWorkById, latestWorks, worksByActor } from "./works";

/**
 * 販売終了になった作品の扱い。
 *
 * 行は消さず、読むときに落とす ([`decisions/0008`](../../../docs/decisions/0008-no-price-no-availability.md))。
 * 落とし忘れると、買えない商品ページへのリンクが一覧に並ぶ
 */

const WORK_ID = "dlsite:RJ90000001";
const LATER = "2026-09-29T00:00:00.000Z";

/** 1 作品を保存した DB。`delisted` を渡すとその値で取り込む */
async function setupWork(delisted?: boolean): Promise<AppDb> {
  const db = await setupDb();
  await ingest(
    db,
    payload({
      works: [
        rawWork({
          storeProductId: "RJ90000001",
          creditedNames: [UEDA.canonicalName],
          ...(delisted === undefined ? {} : { delisted }),
        }),
      ],
    }),
    NOW,
  );
  return db;
}

async function delistedAtOf(db: AppDb): Promise<string | null | undefined> {
  const [row] = await db
    .select({ delistedAt: storeListings.delistedAt })
    .from(storeListings)
    .where(eq(storeListings.storeProductId, "RJ90000001"));
  return row?.delistedAt;
}

describe("取り下げの記録", () => {
  it("買えないと送られた作品に、気づいた日時が入る", async () => {
    const db = await setupWork(true);

    expect(await delistedAtOf(db)).toBe(NOW);
  });

  it("買えると送られた作品には入らない", async () => {
    const db = await setupWork(false);

    expect(await delistedAtOf(db)).toBeNull();
  });

  it("判断が送られてこない作品は、今ある値をそのまま残す", async () => {
    const db = await setupWork(true);

    // 詳細を引いていない走行 (一覧だけ) は delisted を送らない
    await ingest(
      db,
      payload({
        runId: "run-2",
        works: [rawWork({ storeProductId: "RJ90000001", creditedNames: [UEDA.canonicalName] })],
      }),
      LATER,
    );

    expect(await delistedAtOf(db)).toBe(NOW);
  });

  it("取り下げたままの作品を引き直しても、気づいた日時は最初のまま", async () => {
    const db = await setupWork(true);

    await ingest(
      db,
      payload({
        runId: "run-2",
        works: [
          rawWork({
            storeProductId: "RJ90000001",
            creditedNames: [UEDA.canonicalName],
            delisted: true,
          }),
        ],
      }),
      LATER,
    );

    expect(await delistedAtOf(db)).toBe(NOW);
  });

  it("また買えるようになった作品は取り下げが取り消される", async () => {
    const db = await setupWork(true);

    await ingest(
      db,
      payload({
        runId: "run-2",
        works: [
          rawWork({
            storeProductId: "RJ90000001",
            creditedNames: [UEDA.canonicalName],
            delisted: false,
          }),
        ],
      }),
      LATER,
    );

    expect(await delistedAtOf(db)).toBeNull();
  });
});

describe("取り下げた作品の見え方", () => {
  it("買える作品は一覧にも声優ページにも出る", async () => {
    const db = await setupWork(false);

    expect((await latestWorks(db)).map((item) => item.work.id)).toEqual([WORK_ID]);
    expect((await worksByActor(db, UEDA.id)).map((item) => item.work.id)).toEqual([WORK_ID]);
    expect(await getWorkById(db, WORK_ID)).toBeDefined();
  });

  it("取り下げた作品は一覧からも声優ページからも消える", async () => {
    const db = await setupWork(true);

    expect(await latestWorks(db)).toEqual([]);
    expect(await worksByActor(db, UEDA.id)).toEqual([]);
    expect(await getWorkById(db, WORK_ID)).toBeUndefined();
  });

  it("行は残っているので、また買えるようになれば戻る", async () => {
    const db = await setupWork(true);
    expect(await latestWorks(db)).toEqual([]);

    await ingest(
      db,
      payload({
        runId: "run-2",
        works: [
          rawWork({
            storeProductId: "RJ90000001",
            creditedNames: [UEDA.canonicalName],
            delisted: false,
          }),
        ],
      }),
      LATER,
    );

    expect((await latestWorks(db)).map((item) => item.work.id)).toEqual([WORK_ID]);
  });
});
