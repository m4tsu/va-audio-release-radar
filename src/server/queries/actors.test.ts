import { describe, expect, it } from "vitest";
import type { StoreSlug } from "@/domain/types";
import { audioCredits, audioWorks, storeListings } from "../db/schema";
import {
  actorSeedSchema,
  getActorBySlug,
  getActorStoreCoverage,
  listActorDictionary,
  listActors,
  searchActors,
  upsertActors,
} from "./actors";
import { ingest } from "./ingest";
import { recordScreened, screenedStoreProductIds } from "./screened";
import {
  daysAgo,
  giveEachActorAnAnime,
  giveEachActorAWork,
  HANAZAWA,
  NOW,
  payload,
  rawWork,
  setupDb,
  UEDA,
} from "./test-fixtures";

/**
 * 性別の既定は zod スキーマが持つ。省いたシードがそのまま通ることを、
 * 投入の入口 (`POST /api/admin/actors` が使うスキーマ) から見る
 */
describe("actorSeedSchema の性別", () => {
  const SEED = {
    id: "va_sato-rina",
    slug: "sato-rina",
    canonicalName: "佐藤利奈",
    anilistStaffId: 100004,
  };

  it("性別を省いたシードは「不明」で保存される", async () => {
    const db = await setupDb([]);

    await upsertActors(db, [actorSeedSchema.parse(SEED)], NOW);

    expect((await getActorBySlug(db, SEED.slug))?.gender).toBe("unknown");
  });

  it("性別を入れたシードはその値で保存される", async () => {
    const db = await setupDb([]);

    await upsertActors(db, [actorSeedSchema.parse({ ...SEED, gender: "female" })], NOW);

    expect((await getActorBySlug(db, SEED.slug))?.gender).toBe("female");
  });
});

describe("listActorDictionary", () => {
  it("声優と保存済みの別名義を返す", async () => {
    const db = await setupDb([]);
    await upsertActors(
      db,
      [{ ...UEDA, aliases: [{ name: "上田 麗奈", source: "manual", verified: true }] }, HANAZAWA],
      NOW,
    );

    const entries = await listActorDictionary(db);

    expect(entries).toEqual([
      {
        id: HANAZAWA.id,
        slug: HANAZAWA.slug,
        canonicalName: HANAZAWA.canonicalName,
        aliases: [],
      },
      {
        id: UEDA.id,
        slug: UEDA.slug,
        canonicalName: UEDA.canonicalName,
        aliases: [{ name: "上田 麗奈", verified: true }],
      },
    ]);
  });
});

describe("upsertActors", () => {
  it("同じ id で呼び直すと上書きし、alias は重複しない", async () => {
    const db = await setupDb([]);

    await upsertActors(
      db,
      [{ ...UEDA, aliases: [{ name: "上田 麗奈", source: "manual", verified: true }] }],
      NOW,
    );
    await upsertActors(
      db,
      [
        {
          ...UEDA,
          canonicalName: "上田麗奈",
          status: "inactive",
          aliases: [{ name: "上田 麗奈", source: "manual", verified: true }],
        },
      ],
      NOW,
    );

    const actor = await getActorBySlug(db, UEDA.slug);
    expect(actor?.status).toBe("inactive");
    expect(actor?.aliases).toHaveLength(1);
  });

  /**
   * 「対象声優が 1 人も居ない」は辞書に対する判断なので、辞書が増えれば答えが変わる。
   * 捨てないと、新しく追い始めた声優の既存作品が新着一覧から永久に入らない
   */
  it("声優が増えたら、過去の「対象外」の判断を捨てる", async () => {
    const db = await setupDb([]);
    await upsertActors(db, [UEDA], NOW);
    await recordScreened(db, "dlsite", ["RJ1", "RJ2"], NOW);

    const result = await upsertActors(db, [UEDA, HANAZAWA], NOW);

    expect(result.clearedScreened).toBe(2);
    expect(await screenedStoreProductIds(db, "dlsite")).toEqual([]);
  });

  it("別名が増えたときも捨てる", async () => {
    const db = await setupDb([]);
    await upsertActors(db, [UEDA], NOW);
    await recordScreened(db, "dlsite", ["RJ1"], NOW);

    const result = await upsertActors(
      db,
      [{ ...UEDA, aliases: [{ name: "上田 麗奈", source: "manual", verified: true }] }],
      NOW,
    );

    expect(result.clearedScreened).toBe(1);
  });

  // 同じ辞書で呼び直しただけなら答えは変わらない。捨てると往復が無駄に増える
  it("辞書が変わらなければ捨てない", async () => {
    const db = await setupDb([]);
    await upsertActors(db, [UEDA], NOW);
    await recordScreened(db, "dlsite", ["RJ1"], NOW);

    const result = await upsertActors(db, [UEDA], NOW);

    expect(result.clearedScreened).toBe(0);
    expect(await screenedStoreProductIds(db, "dlsite")).toEqual(["RJ1"]);
  });
});

describe("searchActors", () => {
  it("空の検索語では何も返さない", async () => {
    const db = await setupDb();
    expect(await searchActors(db, "")).toEqual([]);
    expect(await searchActors(db, "   ")).toEqual([]);
  });

  it("空白の有無が違っても見つかる", async () => {
    const db = await setupDb();
    await giveEachActorAWork(db, [UEDA]);

    const results = await searchActors(db, "上田 麗奈");

    expect(results.map((actor) => actor.slug)).toEqual([UEDA.slug]);
  });

  it("部分一致でも見つかる", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    await giveEachActorAWork(db, [UEDA, HANAZAWA]);

    const results = await searchActors(db, "上田");

    expect(results.map((actor) => actor.slug)).toEqual([UEDA.slug]);
  });

  it("かな読みでも見つかる", async () => {
    const db = await setupDb();
    await giveEachActorAWork(db, [UEDA]);
    expect((await searchActors(db, "うえだ")).map((actor) => actor.slug)).toEqual([UEDA.slug]);
  });

  it("alias 経由でも見つかる", async () => {
    const db = await setupDb([
      { ...UEDA, aliases: [{ name: "Reina Ueda", source: "store", verified: false }] },
    ]);
    await giveEachActorAWork(db, [UEDA]);

    const results = await searchActors(db, "Reina");

    expect(results.map((actor) => actor.slug)).toEqual([UEDA.slug]);
  });

  it("LIKE のワイルドカードは検索語として効かない", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    await giveEachActorAWork(db, [UEDA, HANAZAWA]);
    expect(await searchActors(db, "%")).toEqual([]);
  });

  it("作品が 1 件も無い声優も作品数 0 で返す", async () => {
    // その人の「初めての 1 本」を待つ人が、検索からフォローへ進めるようにする
    const db = await setupDb([UEDA, HANAZAWA]);
    await giveEachActorAWork(db, [UEDA]);
    await giveEachActorAnAnime(db, [HANAZAWA]);

    const found = await searchActors(db, "花澤");

    expect(found.map((actor) => actor.slug)).toEqual([HANAZAWA.slug]);
    expect(found[0]?.workCount).toBe(0);
    expect(found[0]?.storeSlugs).toEqual([]);
  });
});

describe("listActors", () => {
  it("作品数つきで canonical_name 順に返す", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    await giveEachActorAWork(db, [UEDA, HANAZAWA]);

    const actors = await listActors(db);

    // "上田麗奈" < "花澤香菜" (コードポイント順)
    expect(actors.map((actor) => actor.slug)).toEqual([UEDA.slug, HANAZAWA.slug]);
    expect(actors.map((actor) => actor.workCount)).toEqual([1, 1]);
  });

  it("作品が 1 件も無い声優も作品数 0 で返す", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    await ingest(db, payload(), NOW);
    await giveEachActorAnAnime(db, [HANAZAWA]);

    // payload() が credit を付けるのは 上田麗奈 だけ
    const byslug = new Map((await listActors(db)).map((actor) => [actor.slug, actor.workCount]));

    expect(byslug.get(UEDA.slug)).toBe(1);
    expect(byslug.get(HANAZAWA.slug)).toBe(0);
  });

  /** 一覧は声優ページへのリンクを並べる場所。404 になるページへは送らない */
  it("作品も出演アニメも無い声優は返さない", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    await giveEachActorAWork(db, [UEDA]);

    expect((await listActors(db)).map((actor) => actor.slug)).toEqual([UEDA.slug]);
    expect(await searchActors(db, "花澤")).toEqual([]);
  });

  it("credit の多い声優も作品数を正しく数える", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    await ingest(
      db,
      payload({
        works: [
          rawWork({ creditedNames: ["花澤香菜"] }),
          rawWork({ storeProductId: "RJ00000002", creditedNames: ["花澤香菜"] }),
          rawWork({ storeProductId: "RJ00000003", creditedNames: ["上田麗奈"] }),
        ],
      }),
      NOW,
    );

    const byslug = new Map((await listActors(db)).map((actor) => [actor.slug, actor.workCount]));

    expect(byslug.get(HANAZAWA.slug)).toBe(2);
    expect(byslug.get(UEDA.slug)).toBe(1);
  });

  /** 一覧のストア絞り込みはこの値だけを見る */
  it("作品が載っているストアを STORE_SLUGS の順で返す", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    await giveEachActorAWork(db, [UEDA, HANAZAWA]);
    await ingest(
      db,
      payload({
        runId: "run-audible",
        storeSlug: "audible",
        works: [
          rawWork({
            storeSlug: "audible",
            storeProductId: "B0AUDIBLE1",
            productUrl: "https://www.audible.co.jp/pd/B0AUDIBLE1",
            creditedNames: [UEDA.canonicalName],
          }),
        ],
      }),
      NOW,
    );

    const byslug = new Map((await listActors(db)).map((actor) => [actor.slug, actor.storeSlugs]));

    // 取り込んだ順 (dlsite → audible) ではなく STORE_SLUGS の順で返る
    expect(byslug.get(UEDA.slug)).toEqual(["dlsite", "audible"]);
    expect(byslug.get(HANAZAWA.slug)).toEqual(["dlsite"]);
  });

  /**
   * 画面はこの配列をストアの絞り込みにしか使わない。知らない値が混ざると
   * どの選択肢にも当たらない声優が出るので、取り除いたうえで渡す
   */
  it("掲載が無い作品や、知らないストアの掲載は storeSlugs に出さない", async () => {
    const db = await setupDb([UEDA]);
    await db.insert(audioWorks).values({
      id: "unknown:1",
      title: "掲載の無い作品",
      category: "other",
      ageRating: "unknown",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await db.insert(audioCredits).values({
      audioWorkId: "unknown:1",
      voiceActorId: UEDA.id,
      creditedName: UEDA.canonicalName,
      confidence: "verified",
      sourceStoreSlug: "dlsite",
    });

    expect((await listActors(db))[0]?.storeSlugs).toEqual([]);

    // STORE_SLUGS に無い slug (Phase 2 で足す予定の audiobookjp) を直に入れる
    await db.insert(storeListings).values({
      audioWorkId: "unknown:1",
      storeSlug: "audiobookjp" as StoreSlug,
      storeProductId: "1",
      productUrl: "https://audiobook.jp/product/1",
      titleRaw: "掲載の無い作品",
      firstSeenAt: NOW,
      lastSeenAt: NOW,
      lastCheckedAt: NOW,
    });

    expect((await listActors(db))[0]?.storeSlugs).toEqual([]);
  });
});

describe("getActorBySlug", () => {
  it("居なければ undefined", async () => {
    const db = await setupDb();
    expect(await getActorBySlug(db, "nobody")).toBeUndefined();
  });

  it("作品が 1 件も無くても声優そのものは返す", async () => {
    // 一覧には出さないが、クロール履歴の確認や ingest の名寄せでは要る
    const db = await setupDb();
    expect((await getActorBySlug(db, UEDA.slug))?.id).toBe(UEDA.id);
  });

  it("シードのローマ字表記を保存して返す", async () => {
    const db = await setupDb([{ ...UEDA, nameEn: "Reina Ueda" }]);
    expect((await getActorBySlug(db, UEDA.slug))?.nameEn).toBe("Reina Ueda");
  });

  it("ローマ字表記の無いシードでは nameEn を持たない", async () => {
    // 英語表示はここが無いと canonicalName に落ちる。null を undefined に畳んでおく
    const db = await setupDb();
    expect(await getActorBySlug(db, UEDA.slug)).not.toHaveProperty("nameEn");
  });

  it("alias 込みで返す", async () => {
    const db = await setupDb([
      { ...UEDA, aliases: [{ name: "上田 麗奈", source: "manual", verified: true }] },
    ]);

    const actor = await getActorBySlug(db, UEDA.slug);

    expect(actor?.canonicalName).toBe("上田麗奈");
    expect(actor?.nameKana).toBe("うえだれいな");
    expect(actor?.aliases).toEqual([
      { voiceActorId: UEDA.id, name: "上田 麗奈", source: "manual", verified: true },
    ]);
  });
});

describe("getActorStoreCoverage", () => {
  /** 走行を 1 本取り込む。網羅の判定以外は既定のままでよい */
  async function crawl(
    db: Awaited<ReturnType<typeof setupDb>>,
    run: {
      runId: string;
      storeSlug: StoreSlug;
      startedAt: string;
      coverageComplete?: boolean;
    },
  ) {
    const { coverageComplete, ...rest } = run;
    await ingest(
      db,
      payload({
        ...rest,
        voiceActorId: UEDA.id,
        works: [rawWork({ storeSlug: run.storeSlug, storeProductId: `P-${run.runId}` })],
        ...(coverageComplete === undefined ? {} : { coverageComplete }),
      }),
      NOW,
    );
  }

  it("取り切れていないストアと取り切れたストアを区別して返す", async () => {
    const db = await setupDb();
    await crawl(db, {
      runId: "r-dlsite",
      storeSlug: "dlsite",
      startedAt: NOW,
      coverageComplete: true,
    });
    await crawl(db, {
      runId: "r-audible",
      storeSlug: "audible",
      startedAt: NOW,
      coverageComplete: false,
    });

    expect(await getActorStoreCoverage(db, UEDA.id)).toEqual([
      { storeSlug: "dlsite", complete: true },
      { storeSlug: "audible", complete: false },
    ]);
  });

  it("走行の記録が無いストアは返さない", async () => {
    const db = await setupDb();
    await crawl(db, {
      runId: "r-dlsite",
      storeSlug: "dlsite",
      startedAt: NOW,
      coverageComplete: false,
    });

    expect(await getActorStoreCoverage(db, UEDA.id)).toEqual([
      { storeSlug: "dlsite", complete: false },
    ]);
  });

  /** 真偽を決められなかった走行を「取り切れていない」側に寄せない */
  it("網羅率を一度も記録していないストアは返さない", async () => {
    const db = await setupDb();
    await crawl(db, { runId: "r-dlsite", storeSlug: "dlsite", startedAt: NOW });

    expect(await getActorStoreCoverage(db, UEDA.id)).toEqual([]);
  });

  /** 失敗した走行にも行が残る。直近の 1 行だけを見ると注記が消えて全作品のように見える */
  it("網羅率を記録していない走行は飛ばして手前の走行を見る", async () => {
    const db = await setupDb();
    await crawl(db, {
      runId: "r-known",
      storeSlug: "dlsite",
      startedAt: daysAgo(1),
      coverageComplete: false,
    });
    await crawl(db, { runId: "r-failed", storeSlug: "dlsite", startedAt: NOW });

    expect(await getActorStoreCoverage(db, UEDA.id)).toEqual([
      { storeSlug: "dlsite", complete: false },
    ]);
  });

  it("同じストアでは直近の走行だけを見る", async () => {
    const db = await setupDb();
    await crawl(db, {
      runId: "r-old",
      storeSlug: "dlsite",
      startedAt: daysAgo(3),
      coverageComplete: false,
    });
    await crawl(db, {
      runId: "r-new",
      storeSlug: "dlsite",
      startedAt: NOW,
      coverageComplete: true,
    });

    expect(await getActorStoreCoverage(db, UEDA.id)).toEqual([
      { storeSlug: "dlsite", complete: true },
    ]);
  });

  it("他の声優の走行は混ざらない", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    await ingest(
      db,
      payload({
        runId: "r-hanazawa",
        storeSlug: "dlsite",
        voiceActorId: HANAZAWA.id,
        startedAt: NOW,
        coverageComplete: false,
        works: [rawWork({ storeProductId: "P-hanazawa" })],
      }),
      NOW,
    );

    expect(await getActorStoreCoverage(db, UEDA.id)).toEqual([]);
  });
});
