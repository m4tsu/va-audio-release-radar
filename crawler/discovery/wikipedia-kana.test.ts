import { describe, expect, it } from "vitest";
import type { ActorKanaRecord } from "./actor-kana.ts";
import { summarizeRecords } from "./wikipedia-kana.ts";

function record(overrides: Partial<ActorKanaRecord> = {}): ActorKanaRecord {
  return {
    canonicalName: "上田麗奈",
    status: "ok",
    kana: "うえだれいな",
    source: "furigana",
    fetchedAt: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("summarizeRecords", () => {
  it("状態ごとの人数と、取得元・理由の内訳を数える", () => {
    const summary = summarizeRecords([
      record(),
      record({ canonicalName: "ゆかな", source: "kana-name" }),
      record({ canonicalName: "満島ひかり", status: "rejected", reason: "声優のカテゴリが無い" }),
      record({ canonicalName: "天野聡美", status: "rejected", reason: "声優のカテゴリが無い" }),
      record({ canonicalName: "居ない人", status: "not-found", reason: "記事が無い (HTTP 404)" }),
      record({ canonicalName: "失敗した人", status: "failed", reason: "HTTP 503" }),
    ]);
    expect(summary).toEqual({
      total: 6,
      ok: 2,
      rejected: 2,
      notFound: 1,
      failed: 1,
      bySource: { furigana: 1, "kana-name": 1 },
      byReason: {
        声優のカテゴリが無い: 2,
        "記事が無い (HTTP 404)": 1,
        "HTTP 503": 1,
      },
    });
  });
});
