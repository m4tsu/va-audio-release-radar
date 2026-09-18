import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { audioCredits, audioWorks, crawlRuns, storeListings } from "../db/schema";
import { ingest } from "./ingest";
import { daysAgo, NOW, payload, rawWork, setupDb, UEDA } from "./test-fixtures";

describe("ingest", () => {
  it("はじめて見た作品を new に数え、作品と listing と credit を作る", async () => {
    const db = await setupDb();

    const result = await ingest(db, payload(), NOW);

    expect(result).toEqual({ upserted: 1, new: 1, unmatched: 0, skippedAdult: 0 });

    const works = await db.select().from(audioWorks);
    expect(works).toHaveLength(1);
    expect(works[0]?.id).toBe("dlsite:RJ01698658");
    // storeCategory "SOU" かつジャンル指定なしなので asmr になる (設計書 §4)
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

  it("価格とタイトルは毎回更新される", async () => {
    const db = await setupDb();

    await ingest(db, payload({ works: [rawWork({ price: 1584, listPrice: 1980 })] }), daysAgo(3));
    await ingest(
      db,
      payload({
        runId: "run-2",
        works: [rawWork({ price: 990, listPrice: 1980, titleRaw: "テスト作品 (改訂)" })],
      }),
      NOW,
    );

    const [listing] = await db.select().from(storeListings);
    expect(listing?.price).toBe(990);
    expect(listing?.listPrice).toBe(1980);
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

    // 検索結果には名前が一致しない作品も混ざる。保存はするが声優ページには出さない (設計書 §6)
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

  it("成人向け作品は保存せず skippedAdult にだけ数える", async () => {
    const db = await setupDb();

    const result = await ingest(
      db,
      payload({
        works: [rawWork(), rawWork({ storeProductId: "RJ00000001", adult: true })],
      }),
      NOW,
    );

    expect(result).toEqual({ upserted: 1, new: 1, unmatched: 0, skippedAdult: 1 });
    const works = await db.select().from(audioWorks);
    expect(works.map((work) => work.id)).toEqual(["dlsite:RJ01698658"]);
  });

  it("error 付きの payload は crawl_runs に error として記録する", async () => {
    const db = await setupDb();

    const result = await ingest(
      db,
      payload({ works: [], error: "302 で検索結果に飛ばされた" }),
      NOW,
    );

    expect(result).toEqual({ upserted: 0, new: 0, unmatched: 0, skippedAdult: 0 });
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
});
