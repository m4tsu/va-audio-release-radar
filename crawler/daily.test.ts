import { describe, expect, it } from "vitest";
import type { IngestPayload, RawWork, StoreSlug } from "../src/domain/index.ts";
import type { FeedResult, SourceAdapter } from "./adapters/types.ts";
import { type FeedOutcome, formatOutcome, type IngestTarget, runStore } from "./daily.ts";
import { AdminApiError, type IngestResponse } from "./lib/ingest.ts";

function outcome(partial: Partial<FeedOutcome>): FeedOutcome {
  return {
    storeSlug: "dlsite",
    status: "ok",
    listed: 0,
    sent: 0,
    complete: true,
    warnings: [],
    ...partial,
  };
}

describe("formatOutcome", () => {
  it("一覧・新規・保存・破棄の件数を 1 行に出す", () => {
    expect(formatOutcome(outcome({ listed: 30, sent: 7, saved: 2, dropped: 5 }))).toBe(
      "DLsite ok 一覧 30 件 / 新規 7 件 / 保存 2 件 / 対象声優なしで破棄 5 件",
    );
  });

  // --dry-run では送らないので、取り込み側にしか分からない件数は出せない
  it("送っていない走行では保存と破棄を出さない", () => {
    expect(formatOutcome(outcome({ listed: 30, sent: 7 }))).toBe(
      "DLsite ok 一覧 30 件 / 新規 7 件",
    );
  });

  it("失敗した走行は理由まで出す", () => {
    expect(formatOutcome(outcome({ status: "error", reason: "新着一覧の取得に失敗" }))).toBe(
      "DLsite error 一覧 0 件 / 新規 0 件 (新着一覧の取得に失敗)",
    );
  });

  it("新着が全部既知なら empty として出す", () => {
    expect(formatOutcome(outcome({ status: "empty", listed: 30, saved: 0, dropped: 0 }))).toBe(
      "DLsite empty 一覧 30 件 / 新規 0 件 / 保存 0 件 / 対象声優なしで破棄 0 件",
    );
  });

  // 引けなかった入口があったことは件数からは読めない
  it("一覧の一部を引けなかった走行はそう書く", () => {
    expect(formatOutcome(outcome({ complete: false, listed: 30, sent: 3, saved: 1 }))).toBe(
      "DLsite ok (一覧の一部を引けず) 一覧 30 件 / 新規 3 件 / 保存 1 件",
    );
  });
});

// --- 送る形 ----------------------------------------------------------------

function work(storeProductId: string): RawWork {
  return {
    storeSlug: "dlsite",
    storeProductId,
    titleRaw: `作品 ${storeProductId}`,
    productUrl: `https://example.com/${storeProductId}`,
    creditedNames: ["上田麗奈"],
    ageRating: "general",
    fetchedAt: "2026-09-21T00:00:00.000Z",
  };
}

function feedResult(partial: Partial<FeedResult> = {}): FeedResult {
  return {
    storeSlug: "dlsite",
    status: "ok",
    works: [work("RJ1")],
    invalidCount: 0,
    warnings: [],
    listedCount: 30,
    complete: true,
    pages: 2,
    ...partial,
  };
}

/** `fetchNewReleases` だけを持つ最小の adapter。ネットワークには出ない */
function stubAdapter(result: FeedResult, seen?: { knownIds?: ReadonlySet<string> }): SourceAdapter {
  return {
    storeSlug: "dlsite",
    fetchByActor: () => Promise.reject(new Error("日次では呼ばない")),
    parseSearchHtml: () => ({ works: [], invalidCount: 0, warnings: [] }),
    fetchNewReleases: (options) => {
      if (seen !== undefined && options?.knownIds !== undefined) seen.knownIds = options.knownIds;
      return Promise.resolve(result);
    },
  };
}

const OK_RESPONSE: IngestResponse = {
  upserted: 1,
  new: 1,
  unmatched: 0,
  skippedByRating: 0,
  skippedByNoTargetActor: 0,
};

/** 送られた payload を溜めるだけの取り込み先 */
function stubTarget(
  known: readonly string[] = [],
  respond: (payload: IngestPayload) => Promise<IngestResponse> = () => Promise.resolve(OK_RESPONSE),
): { target: IngestTarget; sent: IngestPayload[] } {
  const sent: IngestPayload[] = [];
  return {
    sent,
    target: {
      knownIds: (_storeSlug: StoreSlug) => Promise.resolve(new Set(known)),
      ingest: (payload) => {
        sent.push(payload);
        return respond(payload);
      },
    },
  };
}

describe("runStore", () => {
  /**
   * 声優を指定しないことがこの走行の要。サーバーはこれを見て
   * 「対象声優が 1 人も居ない作品を捨てる」分岐に入る (src/server/queries/ingest.ts)
   */
  it("voiceActorId を付けずに送る", async () => {
    const { target, sent } = stubTarget();

    await runStore(stubAdapter(feedResult()), target, false);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.storeSlug).toBe("dlsite");
    expect(sent[0]?.runId).toContain("-feed");
    expect(sent[0]?.voiceActorId).toBeUndefined();
  });

  // 新着一覧の総件数はカテゴリ全体の作品数で、網羅率として記録すると意味を取り違える
  it("総件数を送らない。すべて引けた走行では網羅の真偽も送らない", async () => {
    const { target, sent } = stubTarget();

    await runStore(stubAdapter(feedResult()), target, false);

    expect(sent[0]?.totalCount).toBeUndefined();
    // 一覧をすべて引けても、新作を取りこぼしていないことの証明にはならない
    expect(sent[0]?.coverageComplete).toBeUndefined();
  });

  // crawl_runs に残る唯一の手がかり。標準出力は後から見られるとは限らない
  it("一覧の一部を引けなかった走行は coverageComplete を false で送る", async () => {
    const { target, sent } = stubTarget();

    await runStore(stubAdapter(feedResult({ complete: false })), target, false);

    expect(sent[0]?.coverageComplete).toBe(false);
    expect(sent[0]?.totalCount).toBeUndefined();
  });

  it("既知の作品 ID を adapter に渡す", async () => {
    const seen: { knownIds?: ReadonlySet<string> } = {};
    const { target } = stubTarget(["RJ9"]);

    await runStore(stubAdapter(feedResult(), seen), target, false);

    expect([...(seen.knownIds ?? [])]).toEqual(["RJ9"]);
  });

  it("取り込みの結果を保存件数と破棄件数として返す", async () => {
    const { target } = stubTarget([], () =>
      Promise.resolve({
        upserted: 2,
        new: 2,
        unmatched: 1,
        skippedByRating: 0,
        skippedByNoTargetActor: 5,
      }),
    );

    const result = await runStore(stubAdapter(feedResult()), target, false);

    expect(result.saved).toBe(2);
    expect(result.dropped).toBe(5);
  });

  it("送らない走行では取り込み先に触らない", async () => {
    const seen: { knownIds?: ReadonlySet<string> } = {};

    const result = await runStore(stubAdapter(feedResult(), seen), undefined, false);

    expect(seen.knownIds).toBeUndefined();
    expect(result.saved).toBeUndefined();
    expect(result.dropped).toBeUndefined();
  });

  /**
   * 記録が残らないと、走行が動かなかったのか新作が無かったのかを後から区別できない
   * (`crawler/lib/ingest.ts` の `failureReport`)
   */
  it("取り込みに失敗したら、作品を外して error だけ送り直す", async () => {
    let first = true;
    const { target, sent } = stubTarget([], () => {
      if (first) {
        first = false;
        return Promise.reject(new AdminApiError("POST /api/admin/ingest が HTTP 400"));
      }
      return Promise.resolve(OK_RESPONSE);
    });

    const result = await runStore(stubAdapter(feedResult()), target, false);

    expect(sent).toHaveLength(2);
    expect(sent[1]?.works).toEqual([]);
    expect(sent[1]?.error).toContain("HTTP 400");
    // 2 回とも同じ走行として記録する
    expect(sent[1]?.runId).toBe(sent[0]?.runId);
    expect(result.status).toBe("error");
  });

  it("失敗の記録も送れなければ、その旨を理由に残す", async () => {
    const { target } = stubTarget([], () => Promise.reject(new AdminApiError("接続できない")));

    const result = await runStore(stubAdapter(feedResult()), target, false);

    expect(result.status).toBe("error");
    expect(result.reason).toContain("失敗の記録も送れなかった");
  });
});
