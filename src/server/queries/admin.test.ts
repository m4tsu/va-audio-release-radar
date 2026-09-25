import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { audioCredits, crawlRuns, voiceActorAliases } from "../db/schema";
import { upsertActors } from "./actors";
import {
  assignCredit,
  crawlerHealth,
  excludeCreditName,
  listExcludedCreditNames,
  listUnmatchedCredits,
  unexcludeCreditName,
} from "./admin";
import { ingest } from "./ingest";
import { recordScreened, screenedStoreProductIds } from "./screened";
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

  it("対象外の印を付けた表記はキューから外れる", async () => {
    const db = await setupDb();
    await ingest(
      db,
      payload({
        works: [
          rawWork({ storeProductId: "A", creditedNames: ["謎の人"] }),
          rawWork({ storeProductId: "B", creditedNames: ["別の謎"] }),
        ],
      }),
      NOW,
    );

    await excludeCreditName(db, { creditedName: "謎の人", sourceStoreSlug: "dlsite" }, NOW);

    const groups = await listUnmatchedCredits(db);
    expect(groups.map((group) => group.creditedName)).toEqual(["別の謎"]);
  });

  it("印はストアごとに効く。同じ名前でも別のストアなら残る", async () => {
    const db = await setupDb();
    await ingest(
      db,
      payload({ works: [rawWork({ storeProductId: "A", creditedNames: ["謎の人"] })] }),
      NOW,
    );
    await ingest(
      db,
      payload({
        runId: "run-audible",
        storeSlug: "audible",
        works: [rawWork({ storeSlug: "audible", storeProductId: "B", creditedNames: ["謎の人"] })],
      }),
      NOW,
    );

    await excludeCreditName(db, { creditedName: "謎の人", sourceStoreSlug: "dlsite" }, NOW);

    const groups = await listUnmatchedCredits(db);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.sourceStoreSlug).toBe("audible");
  });

  it("印を付けても作品側の credit は未解決のまま残る", async () => {
    const db = await setupDb();
    await ingest(db, payload({ works: [rawWork({ creditedNames: ["謎の人"] })] }), NOW);

    await excludeCreditName(db, { creditedName: "謎の人", sourceStoreSlug: "dlsite" }, NOW);

    const credits = await db
      .select()
      .from(audioCredits)
      .where(eq(audioCredits.creditedName, "謎の人"));
    expect(credits).toHaveLength(1);
    expect(credits[0]?.confidence).toBe("unmatched");
    expect(credits[0]?.voiceActorId).toBeNull();
  });

  it("印は再取り込みで消えない", async () => {
    const db = await setupDb();
    await ingest(db, payload({ works: [rawWork({ creditedNames: ["謎の人"] })] }), daysAgo(1));
    await excludeCreditName(db, { creditedName: "謎の人", sourceStoreSlug: "dlsite" }, daysAgo(1));

    await ingest(
      db,
      payload({ runId: "run-2", works: [rawWork({ creditedNames: ["謎の人"] })] }),
      NOW,
    );

    expect(await listUnmatchedCredits(db)).toHaveLength(0);
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

  /**
   * 別名も名寄せの辞書。足した表記で落ちていた作品を日次が拾い直せるように、
   * 過去の「対象声優が居ない」の判断を捨てる
   */
  it("alias を足したら、過去の「対象外」の判断を捨てる", async () => {
    const db = await setupDb();
    await ingest(db, payload({ works: [rawWork({ creditedNames: ["ReinaU"] })] }), NOW);
    await recordScreened(db, "dlsite", ["RJ1", "RJ2"], NOW);

    await assignCredit(db, {
      creditedName: "ReinaU",
      sourceStoreSlug: "dlsite",
      voiceActorId: UEDA.id,
      addAlias: true,
    });

    expect(await screenedStoreProductIds(db, "dlsite")).toEqual([]);
  });

  // 辞書を触らない割り当てでは捨てない。捨てると往復が無駄に増える
  it("alias を足さない割り当てでは捨てない", async () => {
    const db = await setupDb();
    await ingest(db, payload({ works: [rawWork({ creditedNames: ["ReinaU"] })] }), NOW);
    await recordScreened(db, "dlsite", ["RJ1"], NOW);

    await assignCredit(db, {
      creditedName: "ReinaU",
      sourceStoreSlug: "dlsite",
      voiceActorId: UEDA.id,
      addAlias: false,
    });

    expect(await screenedStoreProductIds(db, "dlsite")).toEqual(["RJ1"]);
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
      /** null を渡すと声優に紐付かない走行 (新着一覧) になる */
      voiceActorId?: string | null;
      /** 取り込んだ時刻。渡さなければ startedAt と同じ (取得に時間がかからなかった走行) */
      finishedAt?: string;
      totalCount?: number;
      coverageComplete?: boolean;
    },
  ) {
    await db.insert(crawlRuns).values({
      id: run.id,
      storeSlug: "dlsite",
      voiceActorId: run.voiceActorId === undefined ? UEDA.id : run.voiceActorId,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt ?? run.startedAt,
      workCount: run.workCount,
      newCount: 0,
      status: run.status,
      error: null,
      totalCount: run.totalCount ?? null,
      coverageComplete: run.coverageComplete ?? null,
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

  it("取り込んだ時刻で並べる (取得を始めた時刻ではない)", async () => {
    const db = await setupDb();
    // 取得は先に始まったが取り込みは後。逆に取得は後だが取り込みは先、の 2 つを作る
    await addRun(db, {
      id: "slow",
      startedAt: daysAgo(3),
      finishedAt: daysAgo(1),
      workCount: 10,
      status: "ok",
    });
    await addRun(db, {
      id: "quick",
      startedAt: daysAgo(2),
      finishedAt: daysAgo(2),
      workCount: 10,
      status: "ok",
      voiceActorId: "va_other",
    });

    const health = await crawlerHealth(db, NOW);

    expect(health.entries.map((entry) => entry.latest.id)).toEqual(["slow", "quick"]);
  });

  it("24 時間の集計は取り込んだ時刻で数える", async () => {
    const db = await setupDb();
    // 取得は 3 日前に始まったが、取り込まれたのは 1 時間前
    const finishedAt = new Date(Date.parse(NOW) - 60 * 60 * 1000).toISOString();
    await addRun(db, {
      id: "slow",
      startedAt: daysAgo(3),
      finishedAt,
      workCount: 10,
      status: "ok",
    });

    const health = await crawlerHealth(db, NOW);

    expect(health.last24h.ok).toBe(1);
  });

  it("声優に紐付かない走行は件数が半減しても警告しない", async () => {
    const db = await setupDb();
    await addRun(db, {
      id: "f1",
      startedAt: daysAgo(2),
      workCount: 30,
      status: "ok",
      voiceActorId: null,
    });
    await addRun(db, {
      id: "f2",
      startedAt: daysAgo(1),
      workCount: 2,
      status: "ok",
      voiceActorId: null,
    });

    const health = await crawlerHealth(db, NOW);

    expect(health.entries[0]?.latest.id).toBe("f2");
    expect(health.entries[0]?.warning).toBe(false);
  });

  /**
   * 日次が止まったことは件数からは読めない。新着一覧の走行は 1 日 1 回なので、
   * 最後に成功してからの時間で判定する (decisions/0007)
   */
  it("声優に紐付かない走行は、しばらく取り込みが無ければ警告する", async () => {
    const db = await setupDb();
    await addRun(db, {
      id: "stale",
      startedAt: daysAgo(3),
      workCount: 30,
      status: "ok",
      voiceActorId: null,
    });

    const health = await crawlerHealth(db, NOW);

    expect(health.entries[0]?.warning).toBe(true);
    expect(health.entries[0]?.warningReason).toBe("72 時間 取り込みがない");
  });

  it("声優に紐付かない走行でも、直近に成功していれば警告しない", async () => {
    const db = await setupDb();
    await addRun(db, {
      id: "fresh",
      startedAt: daysAgo(1),
      workCount: 30,
      status: "ok",
      voiceActorId: null,
    });

    const health = await crawlerHealth(db, NOW);

    expect(health.entries[0]?.warning).toBe(false);
  });

  it("声優に紐付かない走行はストアごとに 1 つの束になり、声優の名前を付けない", async () => {
    const db = await setupDb();
    await addRun(db, {
      id: "f1",
      startedAt: daysAgo(2),
      workCount: 8,
      status: "ok",
      voiceActorId: null,
    });
    await addRun(db, {
      id: "f2",
      startedAt: daysAgo(1),
      workCount: 6,
      status: "ok",
      voiceActorId: null,
    });
    await addRun(db, { id: "a1", startedAt: daysAgo(1), workCount: 30, status: "ok" });

    const health = await crawlerHealth(db, NOW);

    const feed = health.entries.find((entry) => entry.voiceActorId === undefined);
    expect(feed?.latest.id).toBe("f2");
    expect(feed?.previousOk?.id).toBe("f1");
    expect(feed?.voiceActorName).toBeUndefined();
    // 声優起点の束と混ざらない
    expect(health.entries).toHaveLength(2);
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

  it("網羅率を直近の run から持ってくる", async () => {
    const db = await setupDb();
    await addRun(db, {
      id: "r1",
      startedAt: daysAgo(1),
      workCount: 27,
      status: "ok",
      totalCount: 27,
      coverageComplete: true,
    });

    const health = await crawlerHealth(db, NOW);

    expect(health.entries[0]?.latest.totalCount).toBe(27);
    expect(health.entries[0]?.latest.coverageComplete).toBe(true);
  });

  it("網羅率の記録が無い run は undefined のまま返す", async () => {
    // 総件数を読めなかった run を「完全」にも「不完全」にも倒さない
    const db = await setupDb();
    await addRun(db, { id: "r1", startedAt: daysAgo(1), workCount: 27, status: "ok" });

    const health = await crawlerHealth(db, NOW);

    expect(health.entries[0]?.latest.totalCount).toBeUndefined();
    expect(health.entries[0]?.latest.coverageComplete).toBeUndefined();
  });

  it("取り切れていない run は coverageComplete が false で返る", async () => {
    const db = await setupDb();
    await addRun(db, {
      id: "r1",
      startedAt: daysAgo(1),
      workCount: 30,
      status: "ok",
      totalCount: 48,
      coverageComplete: false,
    });

    const health = await crawlerHealth(db, NOW);

    expect(health.entries[0]?.latest.coverageComplete).toBe(false);
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

describe("excludeCreditName / unexcludeCreditName", () => {
  it("付けた印を一覧で見られ、外すとキューに戻る", async () => {
    const db = await setupDb();
    await ingest(db, payload({ works: [rawWork({ creditedNames: ["謎の人"] })] }), NOW);

    await excludeCreditName(
      db,
      { creditedName: "謎の人", sourceStoreSlug: "dlsite", note: "同人サークルの名義" },
      NOW,
    );
    const excluded = await listExcludedCreditNames(db);
    expect(excluded).toEqual([
      {
        creditedName: "謎の人",
        sourceStoreSlug: "dlsite",
        note: "同人サークルの名義",
        createdAt: NOW,
      },
    ]);

    await unexcludeCreditName(db, { creditedName: "謎の人", sourceStoreSlug: "dlsite" });
    expect(await listExcludedCreditNames(db)).toEqual([]);
    expect(await listUnmatchedCredits(db)).toHaveLength(1);
  });

  it("二度付けても 1 件のまま。初回の日時を残して理由だけ書き直せる", async () => {
    const db = await setupDb();

    await excludeCreditName(db, { creditedName: "謎の人", sourceStoreSlug: "dlsite" }, daysAgo(2));
    await excludeCreditName(
      db,
      { creditedName: "謎の人", sourceStoreSlug: "dlsite", note: "後から書いた理由" },
      NOW,
    );

    const excluded = await listExcludedCreditNames(db);
    expect(excluded).toHaveLength(1);
    expect(excluded[0]?.createdAt).toBe(daysAgo(2));
    expect(excluded[0]?.note).toBe("後から書いた理由");
  });

  it("理由を渡さずに付け直しても、書いてある理由は消えない", async () => {
    const db = await setupDb();
    await excludeCreditName(
      db,
      { creditedName: "謎の人", sourceStoreSlug: "dlsite", note: "同人サークルの名義" },
      daysAgo(2),
    );

    await excludeCreditName(db, { creditedName: "謎の人", sourceStoreSlug: "dlsite" }, NOW);

    const excluded = await listExcludedCreditNames(db);
    expect(excluded[0]?.note).toBe("同人サークルの名義");
  });
});
