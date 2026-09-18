import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { audioWorks } from "../db/schema";
import { ingest } from "./ingest";
import { daysAgo, HANAZAWA, NOW, payload, rawWork, setupDb, UEDA } from "./test-fixtures";
import {
  feedForActors,
  getWorkById,
  knownStoreProductIds,
  latestWorks,
  sitemapEntries,
  worksByActor,
} from "./works";

describe("worksByActor", () => {
  it("発売日の新しい順に並べ、発売日が無い作品を末尾に回す", async () => {
    const db = await setupDb();
    await ingest(
      db,
      payload({
        works: [
          rawWork({ storeProductId: "OLD", releaseDate: "2026-08-01" }),
          rawWork({ storeProductId: "NEW", releaseDate: "2026-09-10" }),
          rawWork({ storeProductId: "NODATE" }),
        ],
      }),
      NOW,
    );

    const works = await worksByActor(db, UEDA.id);

    expect(works.map((item) => item.work.id)).toEqual([
      "dlsite:NEW",
      "dlsite:OLD",
      "dlsite:NODATE",
    ]);
    expect(works[0]?.listings).toHaveLength(1);
    expect(works[0]?.listings[0]?.storeSlug).toBe("dlsite");
  });

  it("ストアで絞り込める", async () => {
    const db = await setupDb();
    await ingest(db, payload({ works: [rawWork({ storeProductId: "RJ1" })] }), NOW);
    await ingest(
      db,
      payload({
        runId: "run-audible",
        storeSlug: "audible",
        works: [
          rawWork({
            storeSlug: "audible",
            storeProductId: "B0ABC",
            productUrl: "https://www.audible.co.jp/pd/B0ABC",
            creditedNames: ["上田 麗奈"],
          }),
        ],
      }),
      NOW,
    );

    // "上田 麗奈" は空白を除けば canonicalName と一致するので verified になる
    const all = await worksByActor(db, UEDA.id);
    expect(all).toHaveLength(2);

    const audibleOnly = await worksByActor(db, UEDA.id, { storeSlug: "audible" });
    expect(audibleOnly.map((item) => item.work.id)).toEqual(["audible:B0ABC"]);
  });

  it("credit が無い声優では空になる", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    await ingest(db, payload(), NOW);
    expect(await worksByActor(db, HANAZAWA.id)).toEqual([]);
  });
});

describe("latestWorks", () => {
  it("期間外の作品を除く", async () => {
    const db = await setupDb();
    await ingest(
      db,
      payload({ works: [rawWork({ storeProductId: "OLD", releaseDate: "2026-01-01" })] }),
      daysAgo(90),
    );
    await ingest(
      db,
      payload({
        runId: "run-2",
        works: [rawWork({ storeProductId: "RECENT", releaseDate: "2026-09-10" })],
      }),
      NOW,
    );

    const works = await latestWorks(db, { sinceDays: 30, now: NOW });

    expect(works.map((item) => item.work.id)).toEqual(["dlsite:RECENT"]);
  });

  it("発売日が無くても初出が期間内なら新着として拾う", async () => {
    const db = await setupDb();
    await ingest(db, payload({ works: [rawWork({ storeProductId: "NODATE" })] }), daysAgo(2));

    const works = await latestWorks(db, { sinceDays: 30, now: NOW });

    expect(works.map((item) => item.work.id)).toEqual(["dlsite:NODATE"]);
  });
});

describe("feedForActors", () => {
  it("声優 id が空なら空配列", async () => {
    const db = await setupDb();
    await ingest(db, payload(), NOW);
    expect(await feedForActors(db, [], { now: NOW })).toEqual([]);
  });

  it("期間外は落とし、拾った作品にフォロー中の声優を添える", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    await ingest(
      db,
      payload({ works: [rawWork({ storeProductId: "OLD", releaseDate: "2026-01-01" })] }),
      daysAgo(90),
    );
    await ingest(
      db,
      payload({
        runId: "run-2",
        works: [
          rawWork({
            storeProductId: "RECENT",
            releaseDate: "2026-09-10",
            creditedNames: ["上田麗奈", "花澤香菜"],
          }),
        ],
      }),
      NOW,
    );

    const feed = await feedForActors(db, [UEDA.id], { sinceDays: 30, now: NOW });

    expect(feed.map((item) => item.work.id)).toEqual(["dlsite:RECENT"]);
    // 作品には 2 人の credit があるが、フォローしている声優だけを添える
    expect(feed[0]?.actors).toEqual([{ id: UEDA.id, slug: UEDA.slug, name: "上田麗奈" }]);
  });

  it("フォローしていない声優の作品は入らない", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    await ingest(db, payload({ works: [rawWork({ creditedNames: ["花澤香菜"] })] }), NOW);

    expect(await feedForActors(db, [UEDA.id], { sinceDays: 30, now: NOW })).toEqual([]);
  });
});

describe("getWorkById", () => {
  it("listing と credit を付けて返す", async () => {
    const db = await setupDb();
    await ingest(
      db,
      payload({
        works: [rawWork({ price: 1584, creditedNames: ["上田麗奈", "知らない人"] })],
      }),
      NOW,
    );

    const detail = await getWorkById(db, "dlsite:RJ01698658");

    expect(detail?.work.title).toBe("テスト作品");
    expect(detail?.listings[0]?.price).toBe(1584);
    expect(detail?.credits).toHaveLength(2);
    const resolved = detail?.credits.find((credit) => credit.creditedName === "上田麗奈");
    expect(resolved?.voiceActorSlug).toBe(UEDA.slug);
    const unresolved = detail?.credits.find((credit) => credit.creditedName === "知らない人");
    expect(unresolved?.voiceActorSlug).toBeUndefined();
  });

  it("居なければ undefined", async () => {
    const db = await setupDb();
    expect(await getWorkById(db, "dlsite:NOPE")).toBeUndefined();
  });

  /**
   * 一覧と同じく成人向けは出さない。URL を直接叩いたときだけ見えてしまう穴を塞ぐ
   * (ingest は成人向けを保存しないので、対象になるのは以前入った行だけ)
   */
  it("成人向けの作品は undefined を返す", async () => {
    const db = await setupDb();
    await ingest(db, payload(), NOW);
    await db.update(audioWorks).set({ adult: true }).where(eq(audioWorks.id, "dlsite:RJ01698658"));

    expect(await getWorkById(db, "dlsite:RJ01698658")).toBeUndefined();
  });
});

describe("sitemapEntries", () => {
  it("声優 slug と作品 id を返す", async () => {
    const db = await setupDb();
    await ingest(db, payload(), NOW);

    const entries = await sitemapEntries(db);

    expect(entries.actors).toEqual([{ slug: UEDA.slug, updatedAt: NOW }]);
    expect(entries.works).toEqual([{ id: "dlsite:RJ01698658", updatedAt: NOW }]);
  });
});

describe("knownStoreProductIds", () => {
  it("指定ストアの商品 ID だけを返す", async () => {
    const db = await setupDb();
    await ingest(
      db,
      payload({
        works: [rawWork({ storeProductId: "RJ2" }), rawWork({ storeProductId: "RJ1" })],
      }),
      NOW,
    );
    await ingest(
      db,
      payload({
        runId: "run-2",
        storeSlug: "audible",
        works: [rawWork({ storeSlug: "audible", storeProductId: "B0D6VXP222" })],
      }),
      NOW,
    );

    expect(await knownStoreProductIds(db, "dlsite")).toEqual(["RJ1", "RJ2"]);
    expect(await knownStoreProductIds(db, "audible")).toEqual(["B0D6VXP222"]);
  });

  it("1 件も無いストアでは空配列を返す", async () => {
    const db = await setupDb();
    expect(await knownStoreProductIds(db, "dlsite")).toEqual([]);
  });
});
