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
          }),
        ],
      }),
      NOW,
    );

    expect((await latestWorks(db, { now: NOW })).map((item) => item.work.id)).toHaveLength(2);
    const audibleOnly = await latestWorks(db, { storeSlug: "audible", now: NOW });
    expect(audibleOnly.map((item) => item.work.id)).toEqual(["audible:B0ABC"]);
  });

  it("名寄せ済みの声優を添え、未解決のクレジットは添えない", async () => {
    const db = await setupDb([{ ...UEDA, nameEn: "Reina Ueda" }, HANAZAWA]);
    await ingest(
      db,
      payload({
        works: [rawWork({ creditedNames: ["上田麗奈", "花澤香菜", "名寄せできない表記"] })],
      }),
      NOW,
    );

    const [latest] = await latestWorks(db, { now: NOW });

    expect(latest?.actors).toEqual([
      { id: UEDA.id, slug: UEDA.slug, name: "上田麗奈", nameEn: "Reina Ueda" },
      { id: HANAZAWA.id, slug: HANAZAWA.slug, name: "花澤香菜" },
    ]);
  });

  it("クロールのきっかけになった声優ではなく、クレジットが指す声優を添える", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    await ingest(db, payload({ works: [rawWork({ creditedNames: ["花澤香菜"] })] }), NOW);

    const [latest] = await latestWorks(db, { now: NOW });

    expect(latest?.actors.map((actor) => actor.id)).toEqual([HANAZAWA.id]);
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

  it("ローマ字表記を持つ声優には nameEn も添える", async () => {
    const db = await setupDb([{ ...UEDA, nameEn: "Reina Ueda" }]);
    await ingest(db, payload(), NOW);

    const feed = await feedForActors(db, [UEDA.id], { now: NOW });

    expect(feed[0]?.actors).toEqual([
      { id: UEDA.id, slug: UEDA.slug, name: "上田麗奈", nameEn: "Reina Ueda" },
    ]);
  });

  it("フォローしていない声優の作品は入らない", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    await ingest(db, payload({ works: [rawWork({ creditedNames: ["花澤香菜"] })] }), NOW);

    expect(await feedForActors(db, [UEDA.id], { sinceDays: 30, now: NOW })).toEqual([]);
  });
});

/** NOW から前後した日付 ("YYYY-MM-DD")。発売日の境界を書くのに使う */
function dateFromNow(days: number): string {
  return new Date(Date.parse(NOW) + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 作品 id → freshness の対応表。並び順を見ない検証を短く書くため */
function freshnessById(items: Array<{ work: { id: string }; freshness: string }>) {
  return Object.fromEntries(items.map((item) => [item.work.id, item.freshness]));
}

describe("feedForActors の段", () => {
  it("発売日で upcoming / recent / older を分け、90 日より前は落とす", async () => {
    const db = await setupDb();
    await ingest(
      db,
      payload({
        works: [
          rawWork({ storeProductId: "FUTURE", releaseDate: dateFromNow(1) }),
          rawWork({ storeProductId: "TODAY", releaseDate: dateFromNow(0) }),
          rawWork({ storeProductId: "D30", releaseDate: dateFromNow(-30) }),
          rawWork({ storeProductId: "D31", releaseDate: dateFromNow(-31) }),
          rawWork({ storeProductId: "D90", releaseDate: dateFromNow(-90) }),
          rawWork({ storeProductId: "D91", releaseDate: dateFromNow(-91) }),
        ],
      }),
      NOW,
    );

    const feed = await feedForActors(db, [UEDA.id], { now: NOW });

    expect(freshnessById(feed)).toEqual({
      "dlsite:FUTURE": "upcoming",
      "dlsite:TODAY": "recent",
      "dlsite:D30": "recent",
      "dlsite:D31": "older",
      "dlsite:D90": "older",
    });
  });

  it("upcoming は発売日の近い順、残りは発売日の新しい順に並べる", async () => {
    const db = await setupDb();
    await ingest(
      db,
      payload({
        works: [
          rawWork({ storeProductId: "SOON", releaseDate: dateFromNow(3) }),
          rawWork({ storeProductId: "LATER", releaseDate: dateFromNow(20) }),
          rawWork({ storeProductId: "D2", releaseDate: dateFromNow(-2) }),
          rawWork({ storeProductId: "D20", releaseDate: dateFromNow(-20) }),
          rawWork({ storeProductId: "D40", releaseDate: dateFromNow(-40) }),
        ],
      }),
      NOW,
    );

    const feed = await feedForActors(db, [UEDA.id], { now: NOW });

    expect(feed.map((item) => item.work.id)).toEqual([
      "dlsite:SOON",
      "dlsite:LATER",
      "dlsite:D2",
      "dlsite:D20",
      "dlsite:D40",
    ]);
  });

  it("発売日が 7 日以内なら isNew、発売予定には付けない", async () => {
    const db = await setupDb();
    await ingest(
      db,
      payload({
        works: [
          rawWork({ storeProductId: "FUTURE", releaseDate: dateFromNow(5) }),
          rawWork({ storeProductId: "D7", releaseDate: dateFromNow(-7) }),
          rawWork({ storeProductId: "D8", releaseDate: dateFromNow(-8) }),
        ],
      }),
      NOW,
    );

    const feed = await feedForActors(db, [UEDA.id], { now: NOW });
    const isNewById = Object.fromEntries(feed.map((item) => [item.work.id, item.isNew]));

    expect(isNewById).toEqual({
      "dlsite:FUTURE": false,
      "dlsite:D7": true,
      "dlsite:D8": false,
    });
  });

  /**
   * 初回クロールは既存の全作品を一度に見つける。ここを新着にすると、声優を追加するたびに
   * その人の過去作が丸ごとフィードに流れ込む
   */
  it("発売日が無い作品は、初回クロールで見つかった分を older にする", async () => {
    const db = await setupDb();
    // 初回クロール。ここで見つかった作品は発見日時がベースラインと同じになる
    await ingest(db, payload({ works: [rawWork({ storeProductId: "INITIAL" })] }), daysAgo(40));
    // 2 回目以降に現れた作品だけが新着
    await ingest(
      db,
      payload({ runId: "run-2", works: [rawWork({ storeProductId: "FOUND" })] }),
      daysAgo(5),
    );
    // ベースラインより後だが 30 日より前に見つかった作品は 3 段目
    await ingest(
      db,
      payload({ runId: "run-3", works: [rawWork({ storeProductId: "STALE" })] }),
      daysAgo(35),
    );

    const feed = await feedForActors(db, [UEDA.id], { now: NOW });

    expect(freshnessById(feed)).toEqual({
      "dlsite:INITIAL": "older",
      "dlsite:FOUND": "recent",
      "dlsite:STALE": "older",
    });
    // 初回クロールで見つかった分は、発見から何日経っていても NEW にしない
    const initial = feed.find((item) => item.work.id === "dlsite:INITIAL");
    expect(initial?.isNew).toBe(false);
  });

  /**
   * ベースラインは取り込んだ時刻 (`finished_at`) で取る。クローラーが取得を始めた時刻
   * (`started_at`) で取ると、走行にかかった時間ぶんだけ first_seen_at が後ろにずれ、
   * 初回クロールで見つかった全作品が新着になる
   */
  it("取得を始めた時刻を送っても、初回クロールの作品は新着にならない", async () => {
    const db = await setupDb();
    // 取得を始めたのは取り込みの 3 時間前。1 回の走行が数時間に及ぶ状況。
    // 初回クロールを 3 日前にするのは、基準を取得開始時刻で取ったときに
    // 「3 日前に見つかった新作」として NEW が付いてしまい、差が出るため
    const ingestedAt = daysAgo(3);
    const fetchStartedAt = new Date(Date.parse(ingestedAt) - 3 * 60 * 60 * 1000).toISOString();
    await ingest(
      db,
      payload({ startedAt: fetchStartedAt, works: [rawWork({ storeProductId: "INITIAL" })] }),
      ingestedAt,
    );

    const feed = await feedForActors(db, [UEDA.id], { now: NOW });

    const initial = feed.find((item) => item.work.id === "dlsite:INITIAL");
    expect(initial?.isNew).toBe(false);
    expect(initial?.freshness).toBe("older");
  });

  it("発売日が無い作品は、ベースラインより後 7 日以内の発見で isNew", async () => {
    const db = await setupDb();
    await ingest(db, payload({ works: [rawWork({ storeProductId: "INITIAL" })] }), daysAgo(40));
    await ingest(
      db,
      payload({ runId: "run-2", works: [rawWork({ storeProductId: "FRESH" })] }),
      daysAgo(3),
    );

    const feed = await feedForActors(db, [UEDA.id], { now: NOW });
    const fresh = feed.find((item) => item.work.id === "dlsite:FRESH");

    expect(fresh?.freshness).toBe("recent");
    expect(fresh?.isNew).toBe(true);
  });

  /** 失敗した run はベースラインにしない。取得できなかった日を「見た」ことにはできない */
  it("失敗した run は初回成功クロールの基準にしない", async () => {
    const db = await setupDb();
    await ingest(
      db,
      payload({ runId: "run-error", works: [], error: "取得に失敗した" }),
      daysAgo(60),
    );
    await ingest(db, payload({ works: [rawWork({ storeProductId: "INITIAL" })] }), daysAgo(40));

    const feed = await feedForActors(db, [UEDA.id], { now: NOW });

    expect(freshnessById(feed)).toEqual({ "dlsite:INITIAL": "older" });
  });

  it("発売日が無い作品は、発売日のある作品と同じ並びに混ざる", async () => {
    const db = await setupDb();
    await ingest(db, payload({ works: [rawWork({ storeProductId: "INITIAL" })] }), daysAgo(40));
    await ingest(
      db,
      payload({
        runId: "run-2",
        works: [
          rawWork({ storeProductId: "NODATE" }),
          rawWork({ storeProductId: "DATED", releaseDate: dateFromNow(-1) }),
        ],
      }),
      daysAgo(3),
    );

    const feed = await feedForActors(db, [UEDA.id], { now: NOW });

    // NODATE の発見は 3 日前、DATED の発売は 1 日前。新しい順に並ぶ
    expect(feed.map((item) => item.work.id)).toEqual([
      "dlsite:DATED",
      "dlsite:NODATE",
      "dlsite:INITIAL",
    ]);
  });

  it("limit は段ごとではなく全体にかかる", async () => {
    const db = await setupDb();
    await ingest(
      db,
      payload({
        works: [
          rawWork({ storeProductId: "FUTURE", releaseDate: dateFromNow(2) }),
          rawWork({ storeProductId: "D1", releaseDate: dateFromNow(-1) }),
          rawWork({ storeProductId: "D2", releaseDate: dateFromNow(-2) }),
        ],
      }),
      NOW,
    );

    const feed = await feedForActors(db, [UEDA.id], { now: NOW, limit: 2 });

    expect(feed.map((item) => item.work.id)).toEqual(["dlsite:FUTURE", "dlsite:D1"]);
  });
});

describe("latestWorks / worksByActor の段", () => {
  it("latestWorks もフィードと同じ段と並びになる", async () => {
    const db = await setupDb();
    await ingest(
      db,
      payload({
        works: [
          rawWork({ storeProductId: "FUTURE", releaseDate: dateFromNow(4) }),
          rawWork({ storeProductId: "D3", releaseDate: dateFromNow(-3) }),
          rawWork({ storeProductId: "D40", releaseDate: dateFromNow(-40) }),
        ],
      }),
      NOW,
    );

    const works = await latestWorks(db, { now: NOW });

    expect(works.map((item) => item.work.id)).toEqual(["dlsite:FUTURE", "dlsite:D3", "dlsite:D40"]);
    expect(freshnessById(works)).toEqual({
      "dlsite:FUTURE": "upcoming",
      "dlsite:D3": "recent",
      "dlsite:D40": "older",
    });
  });

  it("worksByActor は発売日の降順のまま freshness を付ける", async () => {
    const db = await setupDb();
    await ingest(
      db,
      payload({
        works: [
          rawWork({ storeProductId: "FUTURE", releaseDate: dateFromNow(4) }),
          rawWork({ storeProductId: "D3", releaseDate: dateFromNow(-3) }),
          rawWork({ storeProductId: "NODATE" }),
        ],
      }),
      NOW,
    );

    const works = await worksByActor(db, UEDA.id, { now: NOW });

    // 発売日が無い作品は末尾のまま (声優ページは全作品を出すので段で並べ替えない)
    expect(works.map((item) => item.work.id)).toEqual([
      "dlsite:FUTURE",
      "dlsite:D3",
      "dlsite:NODATE",
    ]);
    expect(freshnessById(works)).toEqual({
      "dlsite:FUTURE": "upcoming",
      "dlsite:D3": "recent",
      // 初回クロールで見つかった発売日無しの作品は新着にしない
      "dlsite:NODATE": "older",
    });
  });
});

describe("getWorkById", () => {
  it("listing と credit を付けて返す", async () => {
    const db = await setupDb();
    await ingest(
      db,
      payload({
        works: [rawWork({ creditedNames: ["上田麗奈", "知らない人"] })],
      }),
      NOW,
    );

    const detail = await getWorkById(db, "dlsite:RJ01698658");

    expect(detail?.work.title).toBe("テスト作品");
    expect(detail?.listings[0]?.storeProductId).toBe("RJ01698658");
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
   * 一覧と同じく R18 は出さない。URL を直接叩いたときだけ見えてしまう穴を塞ぐ
   * (ingest は R18 を保存しないので、対象になるのは以前入った行だけ)
   */
  it("R18 の作品は undefined を返す", async () => {
    const db = await setupDb();
    await ingest(db, payload(), NOW);
    await db
      .update(audioWorks)
      .set({ ageRating: "r18" })
      .where(eq(audioWorks.id, "dlsite:RJ01698658"));

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

  it("作品が 1 件も無い声優は出さない", async () => {
    // そのページは notFound() を返すので、sitemap に載せると 404 を検索エンジンに出す
    const db = await setupDb([UEDA, HANAZAWA]);
    await ingest(db, payload(), NOW);

    const entries = await sitemapEntries(db);

    expect(entries.actors).toEqual([{ slug: UEDA.slug, updatedAt: NOW }]);
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
