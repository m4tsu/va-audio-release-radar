import { readFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchResult } from "../lib/fetch.ts";
import { FIXTURES_DIR } from "../lib/paths.ts";
import type { ActorKanaCache, ActorKanaRecord } from "./actor-kana.ts";

// 取得の順序と結果の書き換えだけをネットワーク無しで確かめるための差し替え。
// HTML の解析そのものは wikipedia-article.test.ts と wikidata-entity.test.ts が見ている
vi.mock("../lib/fetch.ts", () => ({
  fetchText: vi.fn(),
  rateLimitFor: () => ({ key: "ja.wikipedia.org", intervalMs: 5_000 }),
}));
const { fetchText } = await import("../lib/fetch.ts");
const fetchTextMock = vi.mocked(fetchText);

const {
  NO_ENTITY_REASON,
  NO_KANA_REASON,
  REFILLED_NO_KANA_REASON,
  refillActorKana,
  refillActorKanaAll,
  refillTargets,
  replaceRecord,
  summarizeRefill,
} = await import("./wikipedia-kana-refill.ts");

function article(name: string): string {
  return readFileSync(path.join(FIXTURES_DIR, `wikipedia-ja-${name}.html`), "utf8");
}

function entity(itemId: string): string {
  return readFileSync(path.join(FIXTURES_DIR, `wikidata-${itemId}.html`), "utf8");
}

function ok(body: string): FetchResult {
  return { ok: true, status: 200, url: "https://example.test/x", body };
}

function ng(status: number): FetchResult {
  return { ok: false, status, url: "https://example.test/x", reason: `HTTP ${status}` };
}

/** 引き直しの対象になる行 (前回「読みが書かれていない」で終わった人) */
function target(overrides: Partial<ActorKanaRecord> = {}): ActorKanaRecord {
  return {
    canonicalName: "山路和弘",
    status: "rejected",
    title: "山路和弘",
    pageName: "山路和弘",
    reason: NO_KANA_REASON,
    fetchedAt: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}

function cacheOf(records: ActorKanaRecord[]): ActorKanaCache {
  return {
    startedAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-20T00:00:00.000Z",
    records,
  };
}

async function outFile(): Promise<string> {
  return path.join(await mkdtemp(path.join(tmpdir(), "kana-refill-")), "kana.json");
}

beforeEach(() => {
  fetchTextMock.mockReset();
});

describe("refillTargets", () => {
  it("読みが書かれていなかった人だけを選ぶ", () => {
    const records = [
      target(),
      target({ canonicalName: "上田麗奈", status: "ok", kana: "うえだれいな", reason: undefined }),
      target({ canonicalName: "満島ひかり", reason: "声優のカテゴリが無い" }),
      target({ canonicalName: "朝ノ瑠璃", reason: "別の記事に転送された" }),
      target({ canonicalName: "居ない人", status: "not-found", reason: "記事が無い (HTTP 404)" }),
    ];
    expect(refillTargets(records).map((record) => record.canonicalName)).toEqual(["山路和弘"]);
  });

  it("引き直しても読みが無かった人は、もう選ばない", () => {
    const records = [
      target({ reason: REFILLED_NO_KANA_REASON }),
      target({ reason: NO_ENTITY_REASON }),
    ];
    expect(refillTargets(records)).toEqual([]);
  });

  it("記事名を持たない行は引かない", () => {
    expect(refillTargets([target({ title: undefined })])).toEqual([]);
  });

  it("limit で人数を区切る", () => {
    const records = [target(), target({ canonicalName: "麦人" })];
    expect(refillTargets(records, 1).map((record) => record.canonicalName)).toEqual(["山路和弘"]);
  });
});

describe("refillActorKana", () => {
  it("導入部から読みを取り、Wikidata は引かない", async () => {
    fetchTextMock.mockResolvedValueOnce(ok(article("yamaji-kazuhiro")));
    await expect(refillActorKana(target(), {})).resolves.toMatchObject({
      canonicalName: "山路和弘",
      status: "ok",
      kana: "やまじかずひろ",
      rawKana: "やまじ かずひろ",
      source: "lead",
      wikibaseItemId: "Q3546378",
    });
    expect(fetchTextMock).toHaveBeenCalledTimes(1);
    expect(fetchTextMock.mock.calls[0]?.[0]).toBe(
      "https://ja.wikipedia.org/wiki/%E5%B1%B1%E8%B7%AF%E5%92%8C%E5%BC%98",
    );
  });

  it("導入部で取れなければ Wikidata の項目を引く", async () => {
    fetchTextMock
      .mockResolvedValueOnce(ok(article("yamaji-kazuhiro").replace("（やまじ かずひろ、", "（")))
      .mockResolvedValueOnce(ok(entity("Q3546378")));
    await expect(refillActorKana(target(), {})).resolves.toMatchObject({
      status: "ok",
      kana: "やまじかずひろ",
      source: "wikidata",
      wikibaseItemId: "Q3546378",
    });
    expect(fetchTextMock.mock.calls[1]?.[0]).toBe("https://www.wikidata.org/wiki/Q3546378");
  });

  it("引き直した記事に ふりがな が入っていたらそちらを採る", async () => {
    fetchTextMock.mockResolvedValueOnce(ok(article("ueda-reina")));
    await expect(
      refillActorKana(target({ canonicalName: "上田麗奈", title: "上田麗奈" }), {}),
    ).resolves.toMatchObject({ status: "ok", kana: "うえだれいな", source: "furigana" });
    expect(fetchTextMock).toHaveBeenCalledTimes(1);
  });

  it("記事が本人のものでなくなっていたら、読みを取らずにその理由を残す", async () => {
    // 前回から転送が張られることがある。確かめ直さずに読みだけ取ると別人の読みが入る
    fetchTextMock.mockResolvedValueOnce(ok(article("asano-ruri-redirect")));
    await expect(
      refillActorKana(target({ canonicalName: "朝ノ瑠璃", title: "朝ノ瑠璃" }), {}),
    ).resolves.toMatchObject({ status: "rejected", reason: "別の記事に転送された" });
    expect(fetchTextMock).toHaveBeenCalledTimes(1);
  });

  it("項目 id が記事に無ければ Wikidata を引かない", async () => {
    // 上田麗奈 の記事には wgWikibaseItemId が無い。読みだけ落とせば、項目 id の無い記事になる
    fetchTextMock.mockResolvedValueOnce(
      ok(article("ueda-reina").replace('"ふりがな": {"wt": "うえだ れいな"}, ', "")),
    );
    await expect(
      refillActorKana(target({ canonicalName: "上田麗奈", title: "上田麗奈" }), {}),
    ).resolves.toMatchObject({ status: "rejected", reason: NO_ENTITY_REASON });
    expect(fetchTextMock).toHaveBeenCalledTimes(1);
  });

  it("どちらでも取れなければ、対象と別の理由を残す", async () => {
    fetchTextMock
      .mockResolvedValueOnce(ok(article("yamaji-kazuhiro").replace("（やまじ かずひろ、", "（")))
      .mockResolvedValueOnce(ok("<html><body></body></html>"));
    const record = await refillActorKana(target(), {});
    expect(record).toMatchObject({ status: "rejected", reason: REFILLED_NO_KANA_REASON });
    expect(record.reason).not.toBe(NO_KANA_REASON);
  });

  it("記事を引けなければ失敗として残す", async () => {
    fetchTextMock.mockResolvedValueOnce(ng(503));
    await expect(refillActorKana(target(), {})).resolves.toMatchObject({
      status: "failed",
      httpStatus: 503,
    });
  });

  it("Wikidata を引けなければ失敗として残す", async () => {
    fetchTextMock
      .mockResolvedValueOnce(ok(article("yamaji-kazuhiro").replace("（やまじ かずひろ、", "（")))
      .mockResolvedValueOnce(ng(429));
    await expect(refillActorKana(target(), {})).resolves.toMatchObject({
      status: "failed",
      httpStatus: 429,
    });
  });
});

describe("replaceRecord", () => {
  it("同じ人の行を置き換える (行を増やさない)", () => {
    const cache = cacheOf([target({ canonicalName: "麦人" }), target()]);
    replaceRecord(cache, { ...target(), status: "ok", kana: "やまじかずひろ" });
    expect(cache.records).toHaveLength(2);
    expect(cache.records[1]).toMatchObject({ canonicalName: "山路和弘", kana: "やまじかずひろ" });
  });

  it("行が無ければ投げる", () => {
    expect(() => replaceRecord(cacheOf([]), target())).toThrow(/行が結果に無い/);
  });
});

describe("refillActorKanaAll", () => {
  it("1 人ごとに結果を書き出す", async () => {
    fetchTextMock.mockResolvedValue(ok(article("yamaji-kazuhiro")));
    const cache = cacheOf([target()]);
    const file = await outFile();
    const { done } = await refillActorKanaAll({ targets: [target()], cache, outFile: file });
    expect(done).toHaveLength(1);
    const written = JSON.parse(await readFile(file, "utf8")) as ActorKanaCache;
    expect(written.records).toHaveLength(1);
    expect(written.records[0]).toMatchObject({ status: "ok", source: "lead" });
  });

  it("429 はその場で止める", async () => {
    fetchTextMock.mockResolvedValue(ng(429));
    const cache = cacheOf([target(), target({ canonicalName: "麦人", title: "麦人" })]);
    const { stop, done } = await refillActorKanaAll({
      targets: refillTargets(cache.records),
      cache,
      outFile: await outFile(),
    });
    expect(stop?.kind).toBe("rate-limited");
    expect(done).toHaveLength(1);
  });

  it("例外が出た人も失敗として記録し、次の人へ進む", async () => {
    fetchTextMock
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(ok(article("yamaji-kazuhiro")));
    const cache = cacheOf([target({ canonicalName: "麦人", title: "麦人" }), target()]);
    const { done } = await refillActorKanaAll({
      targets: refillTargets(cache.records),
      cache,
      outFile: await outFile(),
    });
    expect(done.map((record) => record.status)).toEqual(["failed", "ok"]);
  });
});

describe("summarizeRefill", () => {
  it("取得元と理由の内訳を数える", () => {
    expect(
      summarizeRefill([
        target({ status: "ok", source: "lead", reason: undefined }),
        target({ status: "ok", source: "wikidata", reason: undefined }),
        target({ status: "ok", source: "lead", reason: undefined }),
        target({ reason: REFILLED_NO_KANA_REASON }),
        target({ status: "failed", reason: "HTTP 503" }),
      ]),
    ).toEqual({
      total: 5,
      ok: 3,
      bySource: { lead: 2, wikidata: 1 },
      byReason: { [REFILLED_NO_KANA_REASON]: 1, "HTTP 503": 1 },
    });
  });
});
