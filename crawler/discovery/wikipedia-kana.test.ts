import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchResult } from "../lib/fetch.ts";
import { FIXTURES_DIR } from "../lib/paths.ts";
import type { ActorKanaRecord } from "./actor-kana.ts";
import { fetchActorKana, stopReasonFor } from "./wikipedia-kana.ts";

// 引き直しをネットワーク無しで確かめるための差し替え。
// 記事の解析そのものはフィクスチャ側のテスト (wikipedia-article.test.ts) が見ている
vi.mock("../lib/fetch.ts", () => ({
  fetchText: vi.fn(),
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

function failed(httpStatus: number): ActorKanaRecord {
  return {
    canonicalName: "上田麗奈",
    status: "failed",
    httpStatus,
    reason: `HTTP ${httpStatus}`,
    fetchedAt: "2026-09-20T00:00:00.000Z",
  };
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

describe("stopReasonFor", () => {
  it("403 はその場で止める (相手がこちらの取り方を拒んでいる)", () => {
    expect(stopReasonFor(failed(403), 1)?.kind).toBe("forbidden");
  });

  it("429 もその場で止める", () => {
    expect(stopReasonFor(failed(429), 1)?.kind).toBe("rate-limited");
  });

  it("その他の失敗は、続いたときだけ止める", () => {
    expect(stopReasonFor(failed(503), 9)).toBeUndefined();
    expect(stopReasonFor(failed(503), 10)?.kind).toBe("consecutive-failures");
  });

  it("答えが出た人では止めない", () => {
    const notFound: ActorKanaRecord = { ...failed(404), status: "not-found" };
    expect(stopReasonFor(notFound, 10)).toBeUndefined();
  });
});
