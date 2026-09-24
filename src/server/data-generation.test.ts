import { describe, expect, it } from "vitest";
import {
  bumpDataGeneration,
  cacheKeyUrl,
  dataCacheEnabled,
  readDataGeneration,
} from "./data-generation";
import { dataGeneration } from "./db/schema";
import { getActorBySlug, getActorStoreCoverage, listActors, searchActors } from "./queries/actors";
import {
  animeByActor,
  getAnimeBySlug,
  listSeasonAnime,
  listSeasonsWithAnime,
  searchAnime,
} from "./queries/anime";
import { ingest } from "./queries/ingest";
import {
  giveEachActorAnAnime,
  HANAZAWA,
  NOW,
  payload,
  rawWork,
  setupDb,
  UEDA,
} from "./queries/test-fixtures";
import { getWorkById, latestWorks, worksByActor } from "./queries/works";

describe("cacheKeyUrl", () => {
  it("引数の並びが違っても同じキーになる", () => {
    const a = cacheKeyUrl(
      "https://koetrail.com",
      "latestWorks",
      { version: "v1", generation: "g1", date: "2026-09-24" },
      {
        limit: 12,
        storeSlug: "dlsite",
      },
    );
    const b = cacheKeyUrl(
      "https://koetrail.com",
      "latestWorks",
      { version: "v1", generation: "g1", date: "2026-09-24" },
      {
        storeSlug: "dlsite",
        limit: 12,
      },
    );

    expect(a).toBe(b);
  });

  it("版・世代・日付・引数のどれかが違えば別のキーになる", () => {
    const base = cacheKeyUrl(
      "https://koetrail.com",
      "q",
      { version: "v1", generation: "g1", date: "2026-09-24" },
      { id: "a" },
    );

    expect(
      cacheKeyUrl(
        "https://koetrail.com",
        "q",
        { version: "v1", generation: "g2", date: "2026-09-24" },
        { id: "a" },
      ),
    ).not.toBe(base);
    expect(
      cacheKeyUrl(
        "https://koetrail.com",
        "q",
        { version: "v1", generation: "g1", date: "2026-09-25" },
        { id: "a" },
      ),
    ).not.toBe(base);
    expect(
      cacheKeyUrl(
        "https://koetrail.com",
        "q",
        { version: "v1", generation: "g1", date: "2026-09-24" },
        { id: "b" },
      ),
    ).not.toBe(base);
    // 結果の形を変えたデプロイの後に、前の版の結果を読まない
    expect(
      cacheKeyUrl(
        "https://koetrail.com",
        "q",
        { version: "v2", generation: "g1", date: "2026-09-24" },
        { id: "a" },
      ),
    ).not.toBe(base);
  });

  it("値が undefined の引数は無いものとして扱う", () => {
    expect(
      cacheKeyUrl(
        "https://koetrail.com",
        "q",
        { version: "v1", generation: "g", date: "d" },
        { a: "1", b: undefined },
      ),
    ).toBe(
      cacheKeyUrl(
        "https://koetrail.com",
        "q",
        { version: "v1", generation: "g", date: "d" },
        { a: "1" },
      ),
    );
  });

  it("サイト自身のオリジンの下に置く", () => {
    expect(
      cacheKeyUrl("https://koetrail.com", "q", { version: "v1", generation: "g", date: "d" }, {}),
    ).toMatch(/^https:\/\/koetrail\.com\/_data-cache\/q\?/);
  });
});

describe("dataCacheEnabled", () => {
  it('"1" のときだけ使う', () => {
    expect(dataCacheEnabled("1")).toBe(true);
    expect(dataCacheEnabled("")).toBe(false);
    expect(dataCacheEnabled(undefined)).toBe(false);
    expect(dataCacheEnabled("0")).toBe(false);
  });
});

describe("データの世代", () => {
  it("書き込みの後に上げると、前と違う値になる", async () => {
    const db = await setupDb();
    const before = await readDataGeneration(db);

    await bumpDataGeneration(db);

    expect(await readDataGeneration(db)).not.toBe(before);
  });

  it("行が無い DB でも読め、上げると行ができる", async () => {
    const db = await setupDb();
    await db.delete(dataGeneration);

    expect(await readDataGeneration(db)).toBe("none");
    await bumpDataGeneration(db);
    expect(await readDataGeneration(db)).not.toBe("none");
  });
});

/**
 * クエリ結果は JSON で往復してキャッシュに置く (`data-cache.ts`)。値が undefined のキーや Date を返すと、
 * キャッシュから返した結果だけ形が変わる。`toEqual` は undefined のキーの有無を見ないので `toStrictEqual` で比べる
 */
describe("キャッシュするクエリ結果は JSON で往復しても変わらない", () => {
  async function populatedDb() {
    const db = await setupDb([UEDA, HANAZAWA]);
    await ingest(
      db,
      payload({
        works: [
          rawWork({
            storeProductId: "RJ1",
            releaseDate: "2026-09-10",
            creditedNames: ["上田麗奈", "知らない人"],
          }),
          rawWork({ storeProductId: "RJ2" }),
        ],
      }),
      NOW,
    );
    await giveEachActorAnAnime(db, [UEDA, HANAZAWA]);
    return db;
  }

  const roundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

  it("声優・アニメ・作品の公開クエリ", async () => {
    const db = await populatedDb();
    const results: unknown[] = [
      await getActorBySlug(db, UEDA.slug),
      await getActorStoreCoverage(db, UEDA.id),
      await searchActors(db, "上田"),
      await listActors(db),
      await listSeasonAnime(db, 2026, "FALL"),
      await getAnimeBySlug(db, "test-anime"),
      await animeByActor(db, UEDA.id),
      await listSeasonsWithAnime(db),
      await searchAnime(db, "Test"),
      await getWorkById(db, "dlsite:RJ1", NOW),
      await worksByActor(db, UEDA.id, { now: NOW }),
      await latestWorks(db, { now: NOW, storeSlug: "dlsite" }),
    ];

    for (const [index, result] of results.entries()) {
      expect(result, `${index} 番目`).toBeDefined();
      expect(roundTrip(result), `${index} 番目`).toStrictEqual(result);
    }
  });
});
