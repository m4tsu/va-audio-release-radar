import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { audioCredits, crawlRuns, voiceActorAliases } from "../db/schema";
import { upsertActors } from "./actors";
import { assignCredit, crawlerHealth, listUnmatchedCredits } from "./admin";
import { ingest } from "./ingest";
import { daysAgo, HANAZAWA, NOW, payload, rawWork, setupDb, UEDA } from "./test-fixtures";

describe("listUnmatchedCredits", () => {
  it("同じ名前をまとめ、件数と作品例を付ける", async () => {
    const db = await setupDb();
    await ingest(
      db,
      payload({
        works: [
          rawWork({ storeProductId: "A", creditedNames: ["謎の人"] }),
          rawWork({ storeProductId: "B", creditedNames: ["謎の人"] }),
          rawWork({ storeProductId: "C", creditedNames: ["別の謎"] }),
        ],
      }),
      NOW,
    );

    const groups = await listUnmatchedCredits(db);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.creditedName).toBe("謎の人");
    expect(groups[0]?.count).toBe(2);
    expect(groups[0]?.sourceStoreSlug).toBe("dlsite");
    expect(groups[0]?.sampleWorks).toHaveLength(2);
    expect(groups[0]?.candidate).toBeUndefined();
  });

  it("後から登録された声優を候補として提示する", async () => {
    const db = await setupDb([]);
    await ingest(db, payload({ works: [rawWork({ creditedNames: ["上田 麗奈"] })] }), NOW);
    // ingest の時点では声優が居なかったので unmatched のまま残っている
    await upsertActors(db, [UEDA], NOW);

    const groups = await listUnmatchedCredits(db);

    expect(groups[0]?.candidate).toEqual({
      id: UEDA.id,
      slug: UEDA.slug,
      canonicalName: "上田麗奈",
    });
  });
  /**
   * 画面は 1 度に 100 件の表記を要求する (`GROUPS_PER_PAGE`)。`loadSampleWorks` は
   * 表記名を IN 句に並べるので、チャンクをまたいでも全グループに作品例が付くことを固定する。
   * D1 の bound parameter 上限そのものは libsql では再現しないため、
   * 上限を超えないことは `src/server/db/chunked.test.ts` 側で見ている
   */
  it("表記が 100 件あっても全件に作品例が付く (IN 句のチャンクをまたぐ)", async () => {
    const db = await setupDb();
    const names = Array.from({ length: 100 }, (_, i) => `謎の人${String(i).padStart(3, "0")}`);
    await ingest(
      db,
      payload({
        works: names.map((name, i) =>
          rawWork({ storeProductId: `RJ${String(i).padStart(8, "0")}`, creditedNames: [name] }),
        ),
      }),
      NOW,
    );

    const groups = await listUnmatchedCredits(db, 100);

    expect(groups).toHaveLength(100);
    expect(groups.every((group) => group.sampleWorks.length === 1)).toBe(true);
    expect(new Set(groups.map((group) => group.creditedName))).toEqual(new Set(names));
  });
});

describe("assignCredit", () => {
  it("同じ名前の未解決 credit をまとめて verified にし、alias を足す", async () => {
    const db = await setupDb();
    await ingest(
      db,
      payload({
        works: [
          rawWork({ storeProductId: "A", creditedNames: ["ReinaU"] }),
          rawWork({ storeProductId: "B", creditedNames: ["ReinaU"] }),
        ],
      }),
      NOW,
    );

    const result = await assignCredit(db, {
      creditedName: "ReinaU",
      sourceStoreSlug: "dlsite",
      voiceActorId: UEDA.id,
      addAlias: true,
    });

    expect(result).toEqual({ updated: 2, aliasAdded: true });

    const credits = await db
      .select()
      .from(audioCredits)
      .where(eq(audioCredits.creditedName, "ReinaU"));
    expect(credits).toHaveLength(2);
    for (const credit of credits) {
      expect(credit.confidence).toBe("verified");
      expect(credit.voiceActorId).toBe(UEDA.id);
    }

    const aliases = await db.select().from(voiceActorAliases);
    expect(aliases).toEqual([
      expect.objectContaining({ name: "ReinaU", source: "manual", verified: true }),
    ]);
  });

  it("alias を足すと次の ingest で自動的に verified になる", async () => {
    const db = await setupDb();
    await ingest(db, payload({ works: [rawWork({ creditedNames: ["ReinaU"] })] }), NOW);
    await assignCredit(db, {
      creditedName: "ReinaU",
      sourceStoreSlug: "dlsite",
      voiceActorId: UEDA.id,
      addAlias: true,
    });

    const result = await ingest(
      db,
      payload({
        runId: "run-2",
        works: [rawWork({ storeProductId: "NEW", creditedNames: ["ReinaU"] })],
      }),
      NOW,
    );

    expect(result.unmatched).toBe(0);
  });

  /**
   * 手で割り当てた行は、同じ payload が再び流れてきても剥がれてはならない。
   * `addAlias: false` だと ingest 側の名寄せは相変わらず失敗する (unmatched) ので、
   * その unmatched で既存の `voice_actor_id` / `confidence` を上書きしないことを固定する
   */
  it("割り当て後に同じ payload を再取り込みしても verified のまま残る", async () => {
    const db = await setupDb();
    const works = [rawWork({ creditedNames: ["ReinaU"] })];
    await ingest(db, payload({ works }), NOW);

    await assignCredit(db, {
      creditedName: "ReinaU",
      sourceStoreSlug: "dlsite",
      voiceActorId: UEDA.id,
      // alias を作らないので、ingest からは今も名寄せできない表記のまま
      addAlias: false,
    });

    const result = await ingest(db, payload({ runId: "run-2", works }), NOW);

    // ingest 側の判定は unmatched のまま。だが DB の行は書き換えない
    expect(result.unmatched).toBe(1);
    const credits = await db.select().from(audioCredits);
    expect(credits).toHaveLength(1);
    expect(credits[0]?.voiceActorId).toBe(UEDA.id);
    expect(credits[0]?.confidence).toBe("verified");
  });

  it("addAlias が false なら alias を作らない", async () => {
    const db = await setupDb();
    await ingest(db, payload({ works: [rawWork({ creditedNames: ["ReinaU"] })] }), NOW);

    const result = await assignCredit(db, {
      creditedName: "ReinaU",
      sourceStoreSlug: "dlsite",
      voiceActorId: UEDA.id,
      addAlias: false,
    });

    expect(result).toEqual({ updated: 1, aliasAdded: false });
    expect(await db.select().from(voiceActorAliases)).toEqual([]);
  });
});

describe("crawlerHealth", () => {
  /** crawl_runs を直接作る。ingest を通さずに件数の推移だけを組み立てたいため */
  async function addRun(
    db: Awaited<ReturnType<typeof setupDb>>,
    run: {
      id: string;
      startedAt: string;
      workCount: number;
      status: "ok" | "error";
      voiceActorId?: string;
    },
  ) {
    await db.insert(crawlRuns).values({
      id: run.id,
      storeSlug: "dlsite",
      voiceActorId: run.voiceActorId ?? UEDA.id,
      startedAt: run.startedAt,
      finishedAt: run.startedAt,
      workCount: run.workCount,
      newCount: 0,
      status: run.status,
      error: null,
    });
  }

  it("件数が前回の半分未満に落ちたら警告する", async () => {
    const db = await setupDb();
    await addRun(db, { id: "r1", startedAt: daysAgo(2), workCount: 30, status: "ok" });
    await addRun(db, { id: "r2", startedAt: daysAgo(1), workCount: 10, status: "ok" });

    const health = await crawlerHealth(db, NOW);

    expect(health.entries).toHaveLength(1);
    expect(health.entries[0]?.warning).toBe(true);
    expect(health.entries[0]?.latest.id).toBe("r2");
    expect(health.entries[0]?.previousOk?.id).toBe("r1");
    expect(health.entries[0]?.voiceActorName).toBe("上田麗奈");
  });

  it("件数が保たれていれば警告しない", async () => {
    const db = await setupDb();
    await addRun(db, { id: "r1", startedAt: daysAgo(2), workCount: 30, status: "ok" });
    await addRun(db, { id: "r2", startedAt: daysAgo(1), workCount: 28, status: "ok" });

    const health = await crawlerHealth(db, NOW);

    expect(health.entries[0]?.warning).toBe(false);
  });

  it("前回の記録が無ければ警告しない", async () => {
    const db = await setupDb();
    await addRun(db, { id: "r1", startedAt: daysAgo(1), workCount: 0, status: "ok" });

    const health = await crawlerHealth(db, NOW);

    expect(health.entries[0]?.warning).toBe(false);
    expect(health.entries[0]?.previousOk).toBeUndefined();
  });

  it("直近が失敗なら警告し、比較対象は前回の成功 run になる", async () => {
    const db = await setupDb();
    await addRun(db, { id: "r1", startedAt: daysAgo(2), workCount: 30, status: "ok" });
    await addRun(db, { id: "r2", startedAt: daysAgo(1), workCount: 0, status: "error" });

    const health = await crawlerHealth(db, NOW);

    expect(health.entries[0]?.warning).toBe(true);
    expect(health.entries[0]?.previousOk?.id).toBe("r1");
  });

  it("直近 24 時間の成功 / 失敗数を数える", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    await addRun(db, { id: "r1", startedAt: daysAgo(2), workCount: 30, status: "ok" });
    await addRun(db, { id: "r2", startedAt: daysAgo(0.5), workCount: 30, status: "ok" });
    await addRun(db, {
      id: "r3",
      startedAt: daysAgo(0.2),
      workCount: 0,
      status: "error",
      voiceActorId: HANAZAWA.id,
    });

    const health = await crawlerHealth(db, NOW);

    expect(health.last24h).toEqual({ ok: 1, error: 1 });
    // 声優 × ストアごとに 1 行になる
    expect(health.entries).toHaveLength(2);
    // 警告のある行が先頭に来る
    expect(health.entries[0]?.voiceActorId).toBe(HANAZAWA.id);
  });
});
