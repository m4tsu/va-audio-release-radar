import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { audioCredits, audioWorks, crawlRuns, storeListings } from "../db/schema";
import { ingest } from "./ingest";
import { screenedStoreProductIds } from "./screened";
import { daysAgo, NOW, payload, rawWork, setupDb, UEDA } from "./test-fixtures";

describe("ingest", () => {
  it("はじめて見た作品を new に数え、作品と listing と credit を作る", async () => {
    const db = await setupDb();

    const result = await ingest(db, payload(), NOW);

    expect(result).toEqual({
      upserted: 1,
      new: 1,
      unmatched: 0,
      skippedByRating: 0,
      skippedByNoTargetActor: 0,
    });

    const works = await db.select().from(audioWorks);
    expect(works).toHaveLength(1);
    expect(works[0]?.id).toBe("dlsite:RJ01698658");
    // storeCategory "SOU" かつジャンル指定なしなので asmr になる
    expect(works[0]?.category).toBe("asmr");

    const credits = await db.select().from(audioCredits);
    expect(credits).toHaveLength(1);
    expect(credits[0]?.voiceActorId).toBe(UEDA.id);
    expect(credits[0]?.confidence).toBe("verified");
  });

  it("2 回目の取り込みでは new が 0 になり、first_seen_at が初回のまま残る", async () => {
    const db = await setupDb();
    const first = daysAgo(3);

    await ingest(db, payload(), first);
    const second = await ingest(db, payload({ runId: "run-2" }), NOW);

    expect(second.new).toBe(0);
    expect(second.upserted).toBe(1);

    const listings = await db.select().from(storeListings);
    expect(listings).toHaveLength(1);
    expect(listings[0]?.firstSeenAt).toBe(first);
    expect(listings[0]?.lastSeenAt).toBe(NOW);
  });

  it("詳細を飛ばした再取得で、発売日・再生時間・分類が消えない", async () => {
    // クローラーは既知の作品の product.json を取り直さない (--skip-known)。そのとき一覧から
    // 組んだ RawWork には発売日もジャンルも無いので、null で上書きしないことを押さえる
    const db = await setupDb();

    await ingest(
      db,
      payload({
        works: [
          rawWork({
            releaseDate: "2026-08-22",
            durationSeconds: 3600,
            coverImageUrl: "https://img.dlsite.jp/cover.jpg",
            makerName: "テストサークル",
            genres: ["ボイスドラマ"],
          }),
        ],
      }),
      daysAgo(3),
    );
    const [before] = await db.select().from(audioWorks);
    expect(before?.category).toBe("audio_drama");

    await ingest(
      db,
      payload({
        runId: "run-2",
        // 一覧だけから組んだ形。発売日・再生時間・ジャンルが無い
        works: [rawWork({ makerName: "テストサークル" })],
      }),
      NOW,
    );

    const [after] = await db.select().from(audioWorks);
    expect(after?.releaseDate).toBe("2026-08-22");
    expect(after?.durationSeconds).toBe(3600);
    expect(after?.coverImageUrl).toBe("https://img.dlsite.jp/cover.jpg");
    expect(after?.category).toBe("audio_drama");
    expect(after?.updatedAt).toBe(NOW);
  });

  it("詳細が取れたときは分類と発売日を更新する", async () => {
    const db = await setupDb();

    await ingest(db, payload({ works: [rawWork({ genres: ["ASMR"] })] }), daysAgo(3));
    await ingest(
      db,
      payload({
        runId: "run-2",
        works: [rawWork({ genres: ["シチュエーション"], releaseDate: "2026-09-01" })],
      }),
      NOW,
    );

    const [work] = await db.select().from(audioWorks);
    expect(work?.category).toBe("situation_voice");
    expect(work?.releaseDate).toBe("2026-09-01");
  });

  it("商品 URL は毎回更新される", async () => {
    // ストア側で URL の形式が変わっても、古い値のままリンク切れを晒さないことを押さえる
    const db = await setupDb();
    const canonical = "https://www.audible.co.jp/pd/B0D6VXP222";

    await ingest(
      db,
      payload({
        storeSlug: "audible",
        works: [
          rawWork({
            storeSlug: "audible",
            storeProductId: "B0D6VXP222",
            productUrl: "https://www.audible.co.jp/pd/chitose-kun-4/B0D6VXP222",
            titleRaw: "千歳くんはラムネ瓶のなか　４",
          }),
        ],
      }),
      daysAgo(3),
    );
    await ingest(
      db,
      payload({
        runId: "run-2",
        storeSlug: "audible",
        works: [
          rawWork({
            storeSlug: "audible",
            storeProductId: "B0D6VXP222",
            productUrl: canonical,
            titleRaw: "千歳くんはラムネ瓶のなか　４（ガガガ文庫）",
          }),
        ],
      }),
      NOW,
    );

    const [listing] = await db.select().from(storeListings);
    expect(listing?.productUrl).toBe(canonical);
    expect(listing?.titleRaw).toBe("千歳くんはラムネ瓶のなか　４（ガガガ文庫）");
  });

  it("タイトルは毎回更新される", async () => {
    const db = await setupDb();

    await ingest(db, payload({ works: [rawWork()] }), daysAgo(3));
    await ingest(
      db,
      payload({ runId: "run-2", works: [rawWork({ titleRaw: "テスト作品 (改訂)" })] }),
      NOW,
    );

    const [listing] = await db.select().from(storeListings);
    expect(listing?.titleRaw).toBe("テスト作品 (改訂)");
  });

  it("検証済み alias の表記でも verified になる", async () => {
    const db = await setupDb([
      { ...UEDA, aliases: [{ name: "上田 麗奈", source: "manual", verified: true }] },
    ]);

    const result = await ingest(
      db,
      payload({ works: [rawWork({ creditedNames: ["上田 麗奈"] })] }),
      NOW,
    );

    expect(result.unmatched).toBe(0);
    const [credit] = await db.select().from(audioCredits);
    expect(credit?.voiceActorId).toBe(UEDA.id);
    expect(credit?.confidence).toBe("verified");
  });

  it("知らない名前は unmatched として残す", async () => {
    const db = await setupDb();

    const result = await ingest(
      db,
      payload({ works: [rawWork({ creditedNames: ["上田麗奈", "誰か知らない人"] })] }),
      NOW,
    );

    expect(result.unmatched).toBe(1);
    const credits = await db.select().from(audioCredits);
    expect(credits).toHaveLength(2);
    const unknown = credits.find((credit) => credit.creditedName === "誰か知らない人");
    expect(unknown?.voiceActorId).toBeNull();
    expect(unknown?.confidence).toBe("unmatched");
  });

  it("対象声優がクレジットに居ない作品は保存するが、その声優の credit は作らない", async () => {
    const db = await setupDb();

    // 検索結果には名前が一致しない作品も混ざる。保存はするが声優ページには出さない
    const result = await ingest(
      db,
      payload({ works: [rawWork({ creditedNames: ["別の声優"] })] }),
      NOW,
    );

    expect(result.upserted).toBe(1);
    expect(result.unmatched).toBe(1);

    const works = await db.select().from(audioWorks);
    expect(works).toHaveLength(1);

    const linked = await db
      .select()
      .from(audioCredits)
      .where(eq(audioCredits.voiceActorId, UEDA.id));
    expect(linked).toHaveLength(0);
  });

  it("R18 の作品は保存せず skippedByRating にだけ数える", async () => {
    const db = await setupDb();

    const result = await ingest(
      db,
      payload({
        works: [rawWork(), rawWork({ storeProductId: "RJ00000001", ageRating: "r18" })],
      }),
      NOW,
    );

    expect(result).toEqual({
      upserted: 1,
      new: 1,
      unmatched: 0,
      skippedByRating: 1,
      skippedByNoTargetActor: 0,
    });
    const works = await db.select().from(audioWorks);
    expect(works.map((work) => work.id)).toEqual(["dlsite:RJ01698658"]);
  });

  // Audible は年齢区分を公開していないので unknown で届く。これを弾くとストアごと落ちる
  it("年齢区分が unknown の作品は保存する", async () => {
    const db = await setupDb();

    const result = await ingest(db, payload({ works: [rawWork({ ageRating: "unknown" })] }), NOW);

    expect(result.upserted).toBe(1);
    const [work] = await db.select().from(audioWorks);
    expect(work?.ageRating).toBe("unknown");
  });

  // 「R18 は載せない」は今の判断でしかないので、呼び出し側で覆せることを確かめる
  it("allowedAgeRatings を渡せば R18 も保存できる", async () => {
    const db = await setupDb();

    const result = await ingest(
      db,
      payload({ works: [rawWork({ storeProductId: "RJ00000001", ageRating: "r18" })] }),
      NOW,
      { allowedAgeRatings: ["general", "unknown", "r18"] },
    );

    expect(result.skippedByRating).toBe(0);
    const [work] = await db.select().from(audioWorks);
    expect(work?.ageRating).toBe("r18");
  });

  it("storeSection をストアの区分のまま保存する", async () => {
    const db = await setupDb();

    await ingest(db, payload({ works: [rawWork({ storeSection: "home" })] }), NOW);

    const [listing] = await db.select().from(storeListings);
    expect(listing?.storeSection).toBe("home");
  });

  // 既知の作品は詳細取得を飛ばすので storeSection が付かない。null で潰すと区分が消える
  it("storeSection が無い再取り込みでは既存の区分を残す", async () => {
    const db = await setupDb();

    await ingest(db, payload({ works: [rawWork({ storeSection: "home" })] }), daysAgo(3));
    await ingest(db, payload({ runId: "run-2", works: [rawWork()] }), NOW);

    const [listing] = await db.select().from(storeListings);
    expect(listing?.storeSection).toBe("home");
  });

  it("error 付きの payload は crawl_runs に error として記録する", async () => {
    const db = await setupDb();

    const result = await ingest(
      db,
      payload({ works: [], error: "302 で検索結果に飛ばされた" }),
      NOW,
    );

    expect(result).toEqual({
      upserted: 0,
      new: 0,
      unmatched: 0,
      skippedByRating: 0,
      skippedByNoTargetActor: 0,
    });
    const [run] = await db.select().from(crawlRuns);
    expect(run?.status).toBe("error");
    expect(run?.error).toBe("302 で検索結果に飛ばされた");
    expect(run?.workCount).toBe(0);
  });

  it("成功時は crawl_runs に件数つきで ok を記録する", async () => {
    const db = await setupDb();

    await ingest(db, payload(), NOW);

    const [run] = await db.select().from(crawlRuns);
    expect(run?.id).toBe("run-1");
    expect(run?.status).toBe("ok");
    expect(run?.workCount).toBe(1);
    expect(run?.newCount).toBe(1);
    expect(run?.voiceActorId).toBe(UEDA.id);
  });

  it("声優に紐付かない走行 (新着一覧) も crawl_runs に残る", async () => {
    const db = await setupDb();

    const { voiceActorId: _omitted, ...feed } = payload();
    await ingest(db, feed, NOW);

    const [run] = await db.select().from(crawlRuns);
    expect(run?.id).toBe("run-1");
    expect(run?.status).toBe("ok");
    expect(run?.voiceActorId).toBeNull();
    // 作品そのものは声優起点と同じように保存される
    expect(await db.select().from(storeListings)).toHaveLength(1);
  });

  /**
   * 新着一覧にはこのサービスが追っていない声優の作品が大量に流れてくる。
   * 保存すると毎日それが積み上がるので、対象声優が 1 人も居ない作品は捨てる
   */
  it("新着一覧の走行では、対象声優が 1 人も居ない作品を保存しない", async () => {
    const db = await setupDb();
    const { voiceActorId: _omitted, ...base } = payload();

    const result = await ingest(
      db,
      {
        ...base,
        works: [
          rawWork({ storeProductId: "KEEP", creditedNames: ["上田麗奈", "知らない人"] }),
          rawWork({ storeProductId: "DROP", creditedNames: ["知らない人", "別の知らない人"] }),
        ],
      },
      NOW,
    );

    expect(result.upserted).toBe(1);
    expect(result.skippedByNoTargetActor).toBe(1);
    const works = await db.select().from(audioWorks);
    expect(works.map((work) => work.id)).toEqual(["dlsite:KEEP"]);
    // 捨てた作品の credit も残らない
    const credits = await db.select().from(audioCredits);
    expect(credits.map((credit) => credit.creditedName).sort()).toEqual(["上田麗奈", "知らない人"]);
  });

  /**
   * 捨てた作品は `store_listings` に入らないので「既知」にならない。
   * 覚えておかないと、一覧から消えるまで毎日詳細を引き直すことになる
   */
  it("捨てた作品の商品 ID を覚える", async () => {
    const db = await setupDb();
    const { voiceActorId: _omitted, ...base } = payload();

    await ingest(
      db,
      {
        ...base,
        works: [
          rawWork({ storeProductId: "KEEP", creditedNames: ["上田麗奈"] }),
          rawWork({
            storeProductId: "DROP",
            creditedNames: ["知らない人"],
            creditedNamesComplete: true,
          }),
        ],
      },
      NOW,
    );

    // 保存した作品は覚えない。`store_listings` にあるので既知として引ける
    expect(await screenedStoreProductIds(db, "dlsite")).toEqual(["DROP"]);
  });

  /**
   * クローラーは詳細の取得に失敗しても一覧の情報だけで送ってくる。一覧の出演者は
   * 省かれていることがある (DLsite は代表 1 名) ので、そのまま覚えると、全員を見れば
   * 対象声優が居たはずの作品を二度と引かなくなる
   */
  it("出演者が全員そろっていない作品は覚えない", async () => {
    const db = await setupDb();
    const { voiceActorId: _omitted, ...base } = payload();

    await ingest(
      db,
      {
        ...base,
        works: [
          // 詳細を取れず、一覧の代表 1 名だけが乗っている作品
          rawWork({ storeProductId: "PARTIAL", creditedNames: ["知らない人"] }),
          // 出演者欄が空だった作品
          rawWork({ storeProductId: "NO-CREDITS", creditedNames: [] }),
          // 詳細まで取れた作品
          rawWork({
            storeProductId: "SCREENED",
            creditedNames: ["知らない人"],
            creditedNamesComplete: true,
          }),
        ],
      },
      NOW,
    );

    // どれも保存はされないが、覚えるのは全員を見たものだけ
    expect(await screenedStoreProductIds(db, "dlsite")).toEqual(["SCREENED"]);
  });

  it("声優起点の走行では覚えない", async () => {
    const db = await setupDb();

    // 声優起点は対象声優が居なくても保存するので、覚える対象が無い
    await ingest(db, payload({ works: [rawWork({ creditedNames: ["知らない人"] })] }), NOW);

    expect(await screenedStoreProductIds(db, "dlsite")).toEqual([]);
  });

  /** 捨てるのは「保存しない」であって「消す」ではない。削除の経路は持たない */
  it("捨てた作品が既に DB にあっても消さない", async () => {
    const db = await setupDb();
    const work = rawWork({ storeProductId: "KNOWN", creditedNames: ["知らない人"] });
    // 声優起点の走行で一度保存されている
    await ingest(db, payload({ works: [work] }), daysAgo(1));

    const { voiceActorId: _omitted, ...base } = payload();
    const result = await ingest(db, { ...base, runId: "run-feed", works: [work] }, NOW);

    expect(result.skippedByNoTargetActor).toBe(1);
    expect(await db.select().from(audioWorks)).toHaveLength(1);
    expect(await db.select().from(audioCredits)).toHaveLength(1);
    // 触らないので、最後に見た日時は声優起点の走行のときのまま
    const [listing] = await db.select().from(storeListings);
    expect(listing?.lastSeenAt).toBe(daysAgo(1));
  });

  it("捨てた件数は crawl_runs にも残る", async () => {
    const db = await setupDb();
    const { voiceActorId: _omitted, ...base } = payload();

    await ingest(
      db,
      { ...base, works: [rawWork({ storeProductId: "DROP", creditedNames: ["知らない人"] })] },
      NOW,
    );

    const [run] = await db.select().from(crawlRuns);
    expect(run?.skippedNoTargetActorCount).toBe(1);
    expect(run?.workCount).toBe(0);
    // 取得はできているので失敗ではない
    expect(run?.status).toBe("ok");
  });

  /**
   * 声優起点の走行では捨てない。検索した声優の名前が credit に無くても作品は保存する
   * (`docs/architecture.md` の「データの不変条件」)
   */
  it("声優起点の走行では、対象声優が居ない作品も今までどおり保存する", async () => {
    const db = await setupDb();

    const result = await ingest(
      db,
      payload({ works: [rawWork({ storeProductId: "KEEP", creditedNames: ["知らない人"] })] }),
      NOW,
    );

    expect(result.upserted).toBe(1);
    expect(result.skippedByNoTargetActor).toBe(0);
    expect(await db.select().from(audioWorks)).toHaveLength(1);
  });

  it("取得を始めた時刻を受け取れば started_at に入れ、取り込んだ時刻は finished_at に残す", async () => {
    const db = await setupDb();
    const fetchStartedAt = daysAgo(1);

    await ingest(db, payload({ startedAt: fetchStartedAt }), NOW);

    const [run] = await db.select().from(crawlRuns);
    expect(run?.startedAt).toBe(fetchStartedAt);
    expect(run?.finishedAt).toBe(NOW);
  });

  it("取得を始めた時刻が無ければ取り込んだ時刻で埋める", async () => {
    const db = await setupDb();

    await ingest(db, payload(), NOW);

    const [run] = await db.select().from(crawlRuns);
    expect(run?.startedAt).toBe(NOW);
  });

  it("販売終了の日時は取り込みで消えない", async () => {
    const db = await setupDb();
    await ingest(db, payload(), daysAgo(3));
    await db.update(storeListings).set({ delistedAt: daysAgo(2) });

    await ingest(db, payload({ runId: "run-2" }), NOW);

    const [listing] = await db.select().from(storeListings);
    expect(listing?.delistedAt).toBe(daysAgo(2));
  });

  it("網羅率を受け取れば crawl_runs に残す", async () => {
    const db = await setupDb();

    await ingest(db, payload({ totalCount: 27, coverageComplete: true }), NOW);

    const [run] = await db.select().from(crawlRuns);
    expect(run?.totalCount).toBe(27);
    expect(run?.coverageComplete).toBe(true);
  });

  it("網羅率が付いていなければ NULL のままにする", async () => {
    // 総件数を読めなかったことと「全部取れた」ことを DB の段階で混ぜないため
    const db = await setupDb();

    await ingest(db, payload(), NOW);

    const [run] = await db.select().from(crawlRuns);
    expect(run?.totalCount).toBeNull();
    expect(run?.coverageComplete).toBeNull();
  });

  it("取り切れていない run は coverageComplete が false で残る", async () => {
    const db = await setupDb();

    await ingest(db, payload({ totalCount: 40, coverageComplete: false }), NOW);

    const [run] = await db.select().from(crawlRuns);
    expect(run?.totalCount).toBe(40);
    expect(run?.coverageComplete).toBe(false);
  });
});
