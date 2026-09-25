import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchResult } from "../lib/fetch.ts";
import { FIXTURES_DIR } from "../lib/paths.ts";
import type { ActorKanaRecord } from "./actor-kana.ts";

// 取得の順序と結果の形だけをネットワーク無しで確かめるための差し替え。
// HTML の解析そのものは wikipedia-article.test.ts と wikidata-entity.test.ts が見ている
vi.mock("../lib/fetch.ts", () => ({
  fetchText: vi.fn(),
}));
const { fetchText } = await import("../lib/fetch.ts");
const fetchTextMock = vi.mocked(fetchText);

const { NO_ENTITY_REASON, NO_KANA_REASON, REFILLED_NO_KANA_REASON, refillActorKana } = await import(
  "./wikipedia-kana-refill.ts"
);

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

beforeEach(() => {
  fetchTextMock.mockReset();
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

  it("記事が無くなっていたら、失敗ではなく記事が無いとして残す", async () => {
    // 失敗にすると、記事が消えた人が並んだだけで連続失敗の打ち切りに当たる
    fetchTextMock.mockResolvedValueOnce(ng(404));
    await expect(refillActorKana(target(), {})).resolves.toMatchObject({
      status: "not-found",
      httpStatus: 404,
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
