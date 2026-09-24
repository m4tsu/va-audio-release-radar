import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { audioWorks, storeListings } from "../db/schema";
import { ingest } from "./ingest";
import { daysAgo, HANAZAWA, NOW, payload, rawWork, setupDb, UEDA } from "./test-fixtures";
import {
  feedForActors,
  getWorkById,
  knownStoreProductIds,
  latestWorks,
  loadCrawlBaselines,
  sitemapEntries,
  workStatsForActors,
  worksByActor,
} from "./works";

describe("worksByActor", () => {
  /** 発売日を持たない作品を末尾に回すと、そういう作品の多いストアだけ最後にまとまる */
  it("発売日の新しい順に並べ、発売日が無い作品は初出の日付で同じ並びに入れる", async () => {
    const db = await setupDb();
    await ingest(
      db,
      payload({
        works: [
          rawWork({ storeProductId: "OLD", releaseDate: "2026-08-01" }),
          rawWork({ storeProductId: "NEW", releaseDate: "2026-09-10" }),
          // 初出は NOW (2026-09-18) なので、発売日を持つ 2 件より新しい側に入る
          rawWork({ storeProductId: "NODATE" }),
        ],
      }),
      NOW,
    );

    const works = await worksByActor(db, UEDA.id);

    expect(works.map((item) => item.work.id)).toEqual([
      "dlsite:NODATE",
      "dlsite:NEW",
      "dlsite:OLD",
    ]);
    expect(works[0]?.listings).toHaveLength(1);
    expect(works[0]?.listings[0]?.storeSlug).toBe("dlsite");
  });

  /** 声優ページはストアで節に割らないので、引くのも 1 本 (絞るのは画面側) */
  it("ストアをまたいで 1 本の一覧で返す", async () => {
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

    expect(all.map((item) => item.work.id).sort()).toEqual(["audible:B0ABC", "dlsite:RJ1"]);
  });

  it("credit が無い声優では空になる", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    await ingest(db, payload(), NOW);
    expect(await worksByActor(db, HANAZAWA.id)).toEqual([]);
  });
});

describe("workStatsForActors", () => {
  it("作品数といちばん新しい発売日を返す", async () => {
    const db = await setupDb();
    await ingest(
      db,
      payload({
        works: [
          rawWork({ storeProductId: "OLD", releaseDate: "2026-08-01" }),
          rawWork({ storeProductId: "NEW", releaseDate: "2026-09-10" }),
        ],
      }),
      NOW,
    );

    expect(await workStatsForActors(db, [UEDA.id])).toEqual([
      { voiceActorId: UEDA.id, workCount: 2, latestReleaseDate: "2026-09-10" },
    ]);
  });

  /** 見出しに出す最新リリースが、一覧の先頭の作品と食い違わないようにする */
  it("発売日を持たない作品は初出の日付で数える", async () => {
    const db = await setupDb();
    await ingest(
      db,
      payload({
        works: [
          rawWork({ storeProductId: "OLD", releaseDate: "2026-08-01" }),
          rawWork({ storeProductId: "NODATE" }),
        ],
      }),
      NOW,
    );

    expect(await workStatsForActors(db, [UEDA.id])).toEqual([
      { voiceActorId: UEDA.id, workCount: 2, latestReleaseDate: NOW.slice(0, 10) },
    ]);
  });

  it("声優をまとめて数える", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    await ingest(
      db,
      payload({
        works: [rawWork({ storeProductId: "RJ1", creditedNames: ["上田麗奈", "花澤香菜"] })],
      }),
      NOW,
    );

    const stats = await workStatsForActors(db, [UEDA.id, HANAZAWA.id]);

    expect(stats.map((entry) => entry.voiceActorId).sort()).toEqual([UEDA.id, HANAZAWA.id].sort());
    expect(stats.every((entry) => entry.workCount === 1)).toBe(true);
  });

  it("作品を 1 件も持たない声優は返さない", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    await ingest(db, payload(), NOW);

    expect(await workStatsForActors(db, [HANAZAWA.id])).toEqual([]);
    expect(await workStatsForActors(db, [])).toEqual([]);
  });
});

describe("出演者数", () => {
  it("クレジットの人数を数える", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    await ingest(
      db,
      payload({
        works: [
          rawWork({
            storeProductId: "RJ1",
            creditedNames: ["上田麗奈", "花澤香菜", "名寄せできない表記"],
          }),
        ],
      }),
      NOW,
    );

    const [work] = await worksByActor(db, UEDA.id);

    // 名寄せできなかった表記もその作品に出ている 1 人として数える
    expect(work?.castSize).toBe(3);
    expect((await getWorkById(db, "dlsite:RJ1", NOW))?.castSize).toBe(3);
  });

  /** 表記違いで同じ声優に解決された credit は別行として残る (画面の重複排除と同じ数え方にする) */
  it("表記違いで同じ声優に解決された分は 1 人として数える", async () => {
    const db = await setupDb();
    await ingest(
      db,
      payload({
        works: [rawWork({ storeProductId: "RJ1", creditedNames: ["上田麗奈", "上田 麗奈"] })],
      }),
      NOW,
    );

    const [work] = await worksByActor(db, UEDA.id);

    expect(work?.castSize).toBe(1);
  });

  it("クレジットが 1 件も無い作品は 0 になる", async () => {
    const db = await setupDb();
    await ingest(
      db,
      payload({ works: [rawWork({ storeProductId: "RJ1", creditedNames: [] })] }),
      NOW,
    );

    expect((await getWorkById(db, "dlsite:RJ1", NOW))?.castSize).toBe(0);
  });

  it("新着とフィードにも付く", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    await ingest(
      db,
      payload({
        works: [
          rawWork({
            storeProductId: "RJ1",
            releaseDate: "2026-09-10",
            creditedNames: ["上田麗奈", "花澤香菜"],
          }),
        ],
      }),
      NOW,
    );

    expect((await latestWorks(db, { storeSlug: "dlsite", now: NOW }))[0]?.castSize).toBe(2);
    expect((await feedForActors(db, [UEDA.id], { now: NOW }))[0]?.castSize).toBe(2);
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

    const works = await latestWorks(db, { storeSlug: "dlsite", sinceDays: 30, now: NOW });

    expect(works.map((item) => item.work.id)).toEqual(["dlsite:RECENT"]);
  });

  it("発売日が無くても初出が期間内なら新着として拾う", async () => {
    const db = await setupDb();
    await ingest(db, payload({ works: [rawWork({ storeProductId: "NODATE" })] }), daysAgo(2));

    const works = await latestWorks(db, { storeSlug: "dlsite", sinceDays: 30, now: NOW });

    expect(works.map((item) => item.work.id)).toEqual(["dlsite:NODATE"]);
  });

  /**
   * 発売日のある作品と無い作品は別々に引いて合わせる (`latestWorks`)。
   * 片方だけで上限まで埋めると、もう片方の新しい作品が切り落とされる
   */
  it("上限は発売日の有無をまたいで、日付の新しい順にかかる", async () => {
    const db = await setupDb();
    await ingest(
      db,
      payload({
        works: [
          rawWork({ storeProductId: "D1", releaseDate: "2026-09-17" }),
          rawWork({ storeProductId: "D5", releaseDate: "2026-09-13" }),
          rawWork({ storeProductId: "D6", releaseDate: "2026-09-12" }),
        ],
      }),
      NOW,
    );
    await ingest(
      db,
      payload({ runId: "run-2", works: [rawWork({ storeProductId: "NODATE" })] }),
      daysAgo(3),
    );

    const works = await latestWorks(db, { storeSlug: "dlsite", now: NOW, limit: 2 });

    // NODATE の日付は初出の 3 日前 (2026-09-15)。D5 より新しい
    expect(works.map((item) => item.work.id).sort()).toEqual(["dlsite:D1", "dlsite:NODATE"]);
  });

  it("同じ日付の作品は id の順で上限にかかる", async () => {
    const db = await setupDb();
    await ingest(
      db,
      payload({
        works: [
          rawWork({ storeProductId: "B", releaseDate: "2026-09-10" }),
          rawWork({ storeProductId: "A", releaseDate: "2026-09-10" }),
          rawWork({ storeProductId: "C", releaseDate: "2026-09-10" }),
        ],
      }),
      NOW,
    );

    const works = await latestWorks(db, { storeSlug: "dlsite", now: NOW, limit: 2 });

    expect(works.map((item) => item.work.id)).toEqual(["dlsite:A", "dlsite:B"]);
  });

  /**
   * ストアを指定したときは、発売日の無い作品を (ストア, 初出) の索引で新しい順にたどって上限で止める
   * (`latestWorks` の `undatedInStore`)。同じ日付の中では初出の時刻が新しい作品を先に採る
   */
  it("ストアで絞った新着は、発売日の無い作品を初出の新しい順に上限まで出す", async () => {
    const db = await setupDb();
    for (const [id, days] of [
      ["OLD", 5],
      ["MID", 3],
      ["NEW", 1],
    ] as const) {
      await ingest(
        db,
        payload({ runId: `run-${id}`, works: [rawWork({ storeProductId: id })] }),
        daysAgo(days),
      );
    }

    const works = await latestWorks(db, { storeSlug: "dlsite", now: NOW, limit: 2 });

    expect(works.map((item) => item.work.id).sort()).toEqual(["dlsite:MID", "dlsite:NEW"]);
  });

  /** 選ぶ規則と最後に並べる規則が同じなので、同じ日に見つかった作品が上限を超えても選び方がずれない */
  it("同じ日に見つかった発売日の無い作品は、初出の時刻の新しい順に上限まで採る", async () => {
    const db = await setupDb();
    for (const [id, hours] of [
      ["A", 8],
      ["B", 10],
      ["C", 12],
    ] as const) {
      await ingest(
        db,
        payload({ runId: `run-${id}`, works: [rawWork({ storeProductId: id })] }),
        `2026-09-16T${String(hours).padStart(2, "0")}:00:00.000Z`,
      );
    }

    const works = await latestWorks(db, { storeSlug: "dlsite", now: NOW, limit: 2 });

    // 見るのは採った作品。見せる順は段の中の規則 (`compareFeedOrder`) で並べ直される
    expect(works.map((item) => item.work.id).sort()).toEqual(["dlsite:B", "dlsite:C"]);
  });

  /**
   * 発売日のある作品が上限までそろえば、その最後の日付より前に見つかった発売日の無い作品は上位に入らない。
   * 同じ日付は初出の時刻で並べるので、その日に見つかった作品は入りうる (下限はその日を含む)
   */
  it("発売日の無い作品は、発売日のある側の上限件目の日付以降に見つかったものだけが並びに入る", async () => {
    const db = await setupDb();
    await ingest(
      db,
      payload({
        works: [
          rawWork({ storeProductId: "D1", releaseDate: "2026-09-17" }),
          rawWork({ storeProductId: "D2", releaseDate: "2026-09-15" }),
        ],
      }),
      // D2 の初出 (2026-09-13) を、下の A0 の初出より前にする
      daysAgo(5),
    );
    // D2 の発売日と同じ日 (2026-09-15) に見つかった作品。同じ日付の中では初出の遅い A0 が先に並ぶ
    await ingest(
      db,
      payload({ runId: "run-a", works: [rawWork({ storeProductId: "A0" })] }),
      daysAgo(3),
    );
    // D2 より前の日に見つかった作品。上位に入らない
    await ingest(
      db,
      payload({ runId: "run-b", works: [rawWork({ storeProductId: "A1" })] }),
      daysAgo(8),
    );

    const works = await latestWorks(db, { storeSlug: "dlsite", now: NOW, limit: 2 });

    expect(works.map((item) => item.work.id).sort()).toEqual(["dlsite:A0", "dlsite:D1"]);
  });

  it("ストアごとに、そのストアに掲載がある作品だけを返す", async () => {
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

    const dlsiteOnly = await latestWorks(db, { storeSlug: "dlsite", now: NOW });
    expect(dlsiteOnly.map((item) => item.work.id)).toEqual(["dlsite:RJ1"]);
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

    const [latest] = await latestWorks(db, { storeSlug: "dlsite", now: NOW });

    expect(latest?.actors).toEqual([
      { id: UEDA.id, slug: UEDA.slug, name: "上田麗奈", nameEn: "Reina Ueda" },
      { id: HANAZAWA.id, slug: HANAZAWA.slug, name: "花澤香菜" },
    ]);
  });

  it("クロールのきっかけになった声優ではなく、クレジットが指す声優を添える", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    await ingest(db, payload({ works: [rawWork({ creditedNames: ["花澤香菜"] })] }), NOW);

    const [latest] = await latestWorks(db, { storeSlug: "dlsite", now: NOW });

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

    const works = await latestWorks(db, { storeSlug: "dlsite", now: NOW });

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

    // 日付の降順のまま (声優ページは段で並べ替えない)。NODATE の日付は初出の NOW
    expect(works.map((item) => item.work.id)).toEqual([
      "dlsite:FUTURE",
      "dlsite:NODATE",
      "dlsite:D3",
    ]);
    expect(freshnessById(works)).toEqual({
      "dlsite:FUTURE": "upcoming",
      "dlsite:D3": "recent",
      // 初回クロールで見つかった発売日無しの作品は新着にしない
      "dlsite:NODATE": "older",
    });
  });

  /**
   * 初回クロールの基準は、並べる作品の出演者の分だけを読む (`loadCrawlBaselines`)。
   * 読む声優を取り違えると基準が見つからず、後から見つかった作品まで older に落ちる
   */
  it("初回クロールより後に見つかった発売日無しの作品は、どの画面でも recent", async () => {
    const db = await setupDb();
    await ingest(db, payload({ works: [rawWork({ storeProductId: "INITIAL" })] }), daysAgo(40));
    await ingest(
      db,
      payload({ runId: "run-2", works: [rawWork({ storeProductId: "FOUND" })] }),
      daysAgo(5),
    );

    const expected = { "dlsite:INITIAL": "older", "dlsite:FOUND": "recent" };
    expect(freshnessById(await latestWorks(db, { storeSlug: "dlsite", now: NOW }))).toEqual(
      expected,
    );
    expect(freshnessById(await worksByActor(db, UEDA.id, { now: NOW }))).toEqual(expected);
    expect((await getWorkById(db, "dlsite:FOUND", NOW))?.freshness).toBe("recent");
  });
});

describe("loadCrawlBaselines", () => {
  it("声優を渡すと、その声優の分だけを全件のときと同じ値で返す", async () => {
    // IN 句を分割する件数 (90 からストアの数を引いた数) を超える人数にする
    const actors = Array.from({ length: 100 }, (_, index) => ({
      id: `va_test-${index}`,
      slug: `test-${index}`,
      canonicalName: `テスト声優${index}`,
      anilistStaffId: 200000 + index,
      status: "active" as const,
      gender: "female" as const,
    }));
    const db = await setupDb(actors);
    for (const [index, actor] of actors.entries()) {
      await ingest(db, payload({ runId: `run-${index}`, voiceActorId: actor.id, works: [] }), NOW);
    }

    const all = await loadCrawlBaselines(db);
    const requested = actors.slice(1).map((actor) => actor.id);
    const scoped = await loadCrawlBaselines(db, requested);

    expect(scoped.size).toBe(requested.length);
    const excluded = actors[0]?.id ?? "";
    expect([...scoped].sort()).toEqual(
      [...all].filter(([key]) => !key.startsWith(excluded)).sort(),
    );
  });

  it("空の配列なら何も読まない", async () => {
    const db = await setupDb();
    await ingest(db, payload(), NOW);

    expect((await loadCrawlBaselines(db, [])).size).toBe(0);
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

  it("ローマ字表記を持つ声優の credit には voiceActorNameEn を添える", async () => {
    const db = await setupDb([{ ...UEDA, nameEn: "Reina Ueda" }, HANAZAWA]);
    await ingest(
      db,
      payload({ works: [rawWork({ creditedNames: ["上田麗奈", "花澤香菜"] })] }),
      NOW,
    );

    const detail = await getWorkById(db, "dlsite:RJ01698658");

    const ueda = detail?.credits.find((credit) => credit.creditedName === "上田麗奈");
    expect(ueda?.voiceActorNameEn).toBe("Reina Ueda");
    const hanazawa = detail?.credits.find((credit) => credit.creditedName === "花澤香菜");
    expect(hanazawa).not.toHaveProperty("voiceActorNameEn");
  });

  /** アフィリエイト URL は server function が ID から組み立てる (`@/server/affiliate`)。列に残った古い値を出さない */
  it("store_listings.affiliate_url 列の値を返さない", async () => {
    const db = await setupDb();
    await ingest(db, payload(), NOW);
    await db.update(storeListings).set({ affiliateUrl: "https://example.com/stale" });

    const detail = await getWorkById(db, "dlsite:RJ01698658");

    expect(detail?.listings[0]).not.toHaveProperty("affiliateUrl");
  });

  /** DLsite のアフィリエイト URL は所属からフロアを引く (`@/server/affiliate`) */
  it("listing にストアの区分を付ける", async () => {
    const db = await setupDb();
    await ingest(db, payload({ works: [rawWork({ storeSection: "girls" })] }), NOW);

    const detail = await getWorkById(db, "dlsite:RJ01698658");

    expect(detail?.listings[0]?.storeSection).toBe("girls");
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
    // そのページは noindex で返るので、sitemap に載せると指定が食い違う
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
