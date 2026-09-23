import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { storeListings } from "../db/schema";
import type { AppDb } from "../db/types";
import { listActors } from "./actors";
import { recordDelistings } from "./delistings";
import { ingest } from "./ingest";
import { giveEachActorAnAnime, NOW, payload, rawWork, setupDb, UEDA } from "./test-fixtures";
import { getWorkById, latestWorks, sitemapEntries, worksByActor } from "./works";

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

describe("台帳起点の取り下げ", () => {
  it("買えなくなった作品に、気づいた日時が入る", async () => {
    const db = await setupWork(false);

    const result = await recordDelistings(
      db,
      [{ storeSlug: "dlsite", storeProductId: "RJ90000001", delisted: true }],
      LATER,
    );

    expect(result).toEqual({ delisted: 1, relisted: 0, unknown: 0 });
    expect(await delistedAtOf(db)).toBe(LATER);
  });

  it("取り下げ済みの作品を引き直しても、気づいた日時は最初のまま", async () => {
    const db = await setupWork(true);

    const result = await recordDelistings(
      db,
      [{ storeSlug: "dlsite", storeProductId: "RJ90000001", delisted: true }],
      LATER,
    );

    // 日時を上書きすると「いつから買えないのか」が引き直すたびに新しくなる
    expect(result.delisted).toBe(0);
    expect(await delistedAtOf(db)).toBe(NOW);
  });

  it("また買えるようになった作品は取り下げが取り消される", async () => {
    const db = await setupWork(true);

    const result = await recordDelistings(
      db,
      [{ storeSlug: "dlsite", storeProductId: "RJ90000001", delisted: false }],
      LATER,
    );

    expect(result).toEqual({ delisted: 0, relisted: 1, unknown: 0 });
    expect(await delistedAtOf(db)).toBeNull();
  });

  it("台帳に無い商品 ID は数えるだけで、他の作品に手を付けない", async () => {
    const db = await setupWork(false);

    const result = await recordDelistings(
      db,
      [{ storeSlug: "dlsite", storeProductId: "RJ00000000", delisted: true }],
      LATER,
    );

    expect(result).toEqual({ delisted: 0, relisted: 0, unknown: 1 });
    expect(await delistedAtOf(db)).toBeNull();
  });

  it("同じ商品 ID でもストアが違えば触らない", async () => {
    const db = await setupWork(false);

    const result = await recordDelistings(
      db,
      [{ storeSlug: "audible", storeProductId: "RJ90000001", delisted: true }],
      LATER,
    );

    expect(result.unknown).toBe(1);
    expect(await delistedAtOf(db)).toBeNull();
  });
});

describe("取り下げた作品しか無い声優の見え方", () => {
  it("買える作品があるうちは sitemap にも一覧の作品数にも出る", async () => {
    const db = await setupWork(false);

    expect((await sitemapEntries(db)).actors.map((row) => row.slug)).toEqual([UEDA.slug]);
    expect((await listActors(db)).map((row) => row.workCount)).toEqual([1]);
  });

  it("作品がすべて取り下げになると sitemap から消える", async () => {
    const db = await setupWork(true);

    // 声優ページは買える作品も出演アニメも無ければ 404 になる
    // (`routes/voice-actors.$slug.tsx`)。sitemap に残すと 404 を案内することになる
    expect((await sitemapEntries(db)).actors).toEqual([]);
  });

  it("出演アニメがあれば一覧には残る", async () => {
    const db = await setupWork(true);
    await giveEachActorAnAnime(db, [UEDA]);

    // アニメだけでもページは出るので、一覧から消してはいけない
    expect((await listActors(db)).map((row) => row.slug)).toEqual([UEDA.slug]);
  });
});

describe("一覧の作品数", () => {
  /** 作品をもう 1 件足す。作品数が「買える作品の数」かどうかは 2 件ないと見えない */
  async function addWork(db: AppDb, storeProductId: string): Promise<void> {
    await ingest(
      db,
      payload({
        runId: `run-${storeProductId}`,
        works: [rawWork({ storeProductId, creditedNames: [UEDA.canonicalName] })],
      }),
      NOW,
    );
  }

  it("取り下げた作品を数に入れない", async () => {
    // 1 件目は取り下げ済み、2 件目は買える
    const db = await setupWork(true);
    await addWork(db, "RJ90000002");

    expect((await listActors(db)).map((row) => row.workCount)).toEqual([1]);
  });

  it("買える作品が 1 件も無ければ 0 になる", async () => {
    const db = await setupWork(true);
    // 一覧に残すために出演アニメを持たせる。作品数だけを見たいので作品は足さない
    await giveEachActorAnAnime(db, [UEDA]);

    expect((await listActors(db)).map((row) => row.workCount)).toEqual([0]);
  });

  it("載っているストアにも取り下げたストアを出さない", async () => {
    const db = await setupWork(true);
    await addWork(db, "RJ90000002");

    // 2 件とも dlsite なので、取り下げていない 2 件目だけが残る
    expect((await listActors(db)).map((row) => row.storeSlugs)).toEqual([["dlsite"]]);
  });
});

describe("ストアで絞った新着", () => {
  /** 同じ作品を Audible にも並べる。ingest は 1 ストア 1 作品なので直に足す */
  async function alsoOnAudible(db: AppDb): Promise<void> {
    await db.insert(storeListings).values({
      audioWorkId: WORK_ID,
      storeSlug: "audible",
      storeProductId: "B0TEST0001",
      productUrl: "https://www.audible.co.jp/pd/B0TEST0001",
      titleRaw: "テスト作品",
      firstSeenAt: NOW,
      lastSeenAt: NOW,
      lastCheckedAt: NOW,
    });
  }

  it("そのストアで取り下げた作品は、他のストアで買えても出さない", async () => {
    const db = await setupWork(true);
    await alsoOnAudible(db);

    // 作品そのものは Audible で買えるので消えない。消すのは DLsite で絞ったときだけ
    expect((await latestWorks(db, { storeSlug: "audible" })).map((item) => item.work.id)).toEqual([
      WORK_ID,
    ]);
    expect(await latestWorks(db, { storeSlug: "dlsite" })).toEqual([]);
  });
});
