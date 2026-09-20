import { readFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchResult } from "../lib/fetch.ts";
import { FIXTURES_DIR } from "../lib/paths.ts";
import type { ActorKanaCache, ActorKanaRecord } from "./actor-kana.ts";
import { crawlActorKana, fetchActorKana, summarizeRecords } from "./wikipedia-kana.ts";

// 引き直しと停止条件だけをネットワーク無しで確かめるための差し替え。
// 記事の解析そのものはフィクスチャ側のテスト (wikipedia-article.test.ts) が見ている
vi.mock("../lib/fetch.ts", () => ({
  fetchText: vi.fn(),
  rateLimitFor: () => ({ key: "ja.wikipedia.org", intervalMs: 5_000 }),
}));
const { fetchText } = await import("../lib/fetch.ts");
const fetchTextMock = vi.mocked(fetchText);

function fixture(name: string): string {
  return readFileSync(path.join(FIXTURES_DIR, `wikipedia-ja-${name}.html`), "utf8");
}

function ok(body: string): FetchResult {
  return { ok: true, status: 200, url: "https://ja.wikipedia.org/wiki/x", body };
}

function ng(status: number): FetchResult {
  return { ok: false, status, url: "https://ja.wikipedia.org/wiki/x", reason: `HTTP ${status}` };
}

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

function emptyCache(): ActorKanaCache {
  return {
    startedAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-20T00:00:00.000Z",
    records: [],
  };
}

async function outFile(): Promise<string> {
  return path.join(await mkdtemp(path.join(tmpdir(), "wikipedia-kana-")), "kana.json");
}

beforeEach(() => {
  fetchTextMock.mockReset();
});

describe("fetchActorKana", () => {
  it("素の記事名で取れたら 1 回で終わる", async () => {
    fetchTextMock.mockResolvedValueOnce(ok(fixture("ueda-reina")));

    const result = await fetchActorKana("上田麗奈", {});

    expect(fetchTextMock).toHaveBeenCalledTimes(1);
    expect(fetchTextMock.mock.calls[0]?.[0]).toBe(
      "https://ja.wikipedia.org/wiki/%E4%B8%8A%E7%94%B0%E9%BA%97%E5%A5%88",
    );
    expect(result).toMatchObject({ status: "ok", kana: "うえだれいな", title: "上田麗奈" });
  });

  it("記事が無ければ (声優) 付きで引き直す", async () => {
    fetchTextMock.mockResolvedValueOnce(ng(404));
    fetchTextMock.mockResolvedValueOnce(ok(fixture("amano-satomi-actor")));

    const result = await fetchActorKana("天野聡美", {});

    expect(fetchTextMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ status: "ok", kana: "あまのさとみ", title: "天野聡美_(声優)" });
  });

  it("曖昧さ回避に当たったときも (声優) 付きで引き直す", async () => {
    fetchTextMock.mockResolvedValueOnce(ok(fixture("amano-satomi-disambig")));
    fetchTextMock.mockResolvedValueOnce(ok(fixture("amano-satomi-actor")));

    expect(await fetchActorKana("天野聡美", {})).toMatchObject({
      status: "ok",
      kana: "あまのさとみ",
    });
  });

  it("どちらの記事名でも取れなければ、最後の理由を残す", async () => {
    fetchTextMock.mockResolvedValueOnce(ok(fixture("mitsushima-hikari")));
    fetchTextMock.mockResolvedValueOnce(ng(404));

    expect(await fetchActorKana("満島ひかり", {})).toMatchObject({
      status: "rejected",
      reason: "声優のカテゴリが無い",
      title: "満島ひかり",
    });
  });

  it("どちらの記事名も 404 なら記事が無い", async () => {
    fetchTextMock.mockResolvedValue(ng(404));

    expect(await fetchActorKana("居ない人", {})).toMatchObject({
      status: "not-found",
      httpStatus: 404,
    });
  });

  it("404 以外の失敗は引き直さずに失敗として残す", async () => {
    fetchTextMock.mockResolvedValueOnce(ng(503));

    expect(await fetchActorKana("上田麗奈", {})).toMatchObject({
      status: "failed",
      httpStatus: 503,
    });
    expect(fetchTextMock).toHaveBeenCalledTimes(1);
  });
});

describe("crawlActorKana", () => {
  it("取れなかった人が居ても止まらず、結果を書き足していく", async () => {
    fetchTextMock.mockResolvedValueOnce(ng(503));
    fetchTextMock.mockResolvedValueOnce(ok(fixture("ueda-reina")));
    const cache = emptyCache();
    const file = await outFile();

    const { stop } = await crawlActorKana({
      canonicalNames: ["失敗する人", "上田麗奈"],
      cache,
      outFile: file,
    });

    expect(stop).toBeUndefined();
    expect(cache.records.map((item) => item.status)).toEqual(["failed", "ok"]);
    // 途中で落ちても続きから進めるよう、1 人ごとに書く
    const written = JSON.parse(await readFile(file, "utf8")) as ActorKanaCache;
    expect(written.records).toHaveLength(2);
  });

  it("例外が出た人も失敗として記録し、次の人へ進む", async () => {
    fetchTextMock.mockRejectedValueOnce(new Error("書き込みに失敗"));
    fetchTextMock.mockResolvedValueOnce(ok(fixture("ueda-reina")));
    const cache = emptyCache();

    await crawlActorKana({
      canonicalNames: ["例外が出る人", "上田麗奈"],
      cache,
      outFile: await outFile(),
    });

    expect(cache.records[0]).toMatchObject({ status: "failed", reason: "Error: 書き込みに失敗" });
    expect(cache.records[1]).toMatchObject({ status: "ok" });
  });

  it("403 はその場で止める (相手がこちらの取り方を拒んでいる)", async () => {
    fetchTextMock.mockResolvedValueOnce(ng(403));
    const cache = emptyCache();

    const { stop } = await crawlActorKana({
      canonicalNames: ["上田麗奈", "ゆかな"],
      cache,
      outFile: await outFile(),
    });

    expect(stop?.kind).toBe("forbidden");
    expect(cache.records).toHaveLength(1);
  });

  it("429 もその場で止める", async () => {
    fetchTextMock.mockResolvedValueOnce(ng(429));
    const cache = emptyCache();

    const { stop } = await crawlActorKana({
      canonicalNames: ["上田麗奈", "ゆかな"],
      cache,
      outFile: await outFile(),
    });

    expect(stop?.kind).toBe("rate-limited");
  });

  it("失敗が続いたら止める", async () => {
    fetchTextMock.mockResolvedValue(ng(503));
    const cache = emptyCache();
    const names = Array.from({ length: 20 }, (_, index) => `失敗する人${index}`);

    const { stop } = await crawlActorKana({
      canonicalNames: names,
      cache,
      outFile: await outFile(),
    });

    expect(stop?.kind).toBe("consecutive-failures");
    expect(cache.records.length).toBeLessThan(names.length);
  });
});

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
