import { afterEach, describe, expect, it, vi } from "vitest";
import { INGEST_PROTOCOL_VERSION } from "../../src/domain/index.ts";
import {
  AdminApiClient,
  AdminApiError,
  failureReport,
  IngestProtocolMismatchError,
} from "./ingest.ts";

/**
 * `fetch` を差し替えてリトライと認可ヘッダだけを確認する。ネットワークには出ない。
 * 待ち時間はフェイクタイマーで飛ばす (実時間で待つと 35 秒かかるため)
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** リトライの待ちを実時間で消化しないよう、タイマーを自動で進めながら実行する */
async function withFakeTimers<T>(run: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  const promise = run();
  // タイマーを進めている間に reject されるので、先にハンドラを付けておく。
  // 付けないと未処理の rejection として報告される (返り値の待ち手は別に付く)
  promise.catch(() => {});
  await vi.runAllTimersAsync();
  return promise;
}

describe("AdminApiClient", () => {
  it("Bearer トークンを付け、末尾スラッシュを重ねない", async () => {
    const fetchMock = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await new AdminApiClient("http://localhost:5199/", "dev").knownIds("dlsite");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:5199/api/admin/known-ids?store=dlsite");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer dev");
  });

  it("到達できないときはやり直し、成功すれば結果を返す", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse({ actors: 1, aliases: 2 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await withFakeTimers(() =>
      new AdminApiClient("http://x", "dev").upsertActors([
        { id: "va_a", slug: "a", canonicalName: "あ" },
      ]),
    );

    expect(result).toEqual({ actors: 1, aliases: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("5xx もやり直す", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "落ちた" }, 500))
      .mockResolvedValueOnce(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await withFakeTimers(() => new AdminApiClient("http://x", "dev").knownIds("audible"));

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("4xx はやり直さず、本文を添えて失敗させる", async () => {
    // payload が不正なときは何度送っても同じ。相手に無駄な負荷をかけない
    const fetchMock = vi.fn(async () => jsonResponse({ error: "payload が不正" }, 400));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new AdminApiClient("http://x", "dev").knownIds("dlsite")).rejects.toThrow(
      AdminApiError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("3 回とも駄目なら理由を添えて諦める", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      withFakeTimers(() => new AdminApiClient("http://x", "dev").knownIds("dlsite")),
    ).rejects.toThrow(/到達できない.*fetch failed/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("プロトコル版の不一致", () => {
  it("409 は IngestProtocolMismatchError にする", async () => {
    // 呼び出し側 (run.ts) が「1 件の失敗」と「走行ごと止める」を型で見分けるため
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: "クローラーが古い", expectedProtocolVersion: 2 }, 409),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new AdminApiClient("http://x", "dev").ingest(
        failureReport({ runId: "r", storeSlug: "dlsite", voiceActorId: "va_a" }, "理由"),
      ),
    ).rejects.toThrow(IngestProtocolMismatchError);
  });

  it("409 はやり直さない", async () => {
    // 何度送っても同じ。相手にも自分にも無駄な往復をさせない
    const fetchMock = vi.fn(async () => jsonResponse({ error: "クローラーが古い" }, 409));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new AdminApiClient("http://x", "dev").ingest(
        failureReport({ runId: "r", storeSlug: "dlsite", voiceActorId: "va_a" }, "理由"),
      ),
    ).rejects.toThrow(IngestProtocolMismatchError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("400 は IngestProtocolMismatchError にはしない", async () => {
    // payload が 1 件だけ不正なケース。走行を止める理由にはならない
    const fetchMock = vi.fn(async () => jsonResponse({ error: "payload が不正" }, 400));
    vi.stubGlobal("fetch", fetchMock);

    const failure = new AdminApiClient("http://x", "dev")
      .ingest(failureReport({ runId: "r", storeSlug: "dlsite", voiceActorId: "va_a" }, "理由"))
      .catch((error: unknown) => error);

    expect(await failure).toBeInstanceOf(AdminApiError);
    expect(await failure).not.toBeInstanceOf(IngestProtocolMismatchError);
  });
});

describe("failureReport", () => {
  it("works を空にして error だけを載せる", () => {
    // 元の payload そのもの (大きすぎる / 形が古い) が失敗の原因でありうるので、
    // 同じものを送り直さない
    const report = failureReport(
      { runId: "2026-09-18-dlsite-ueda-reina", storeSlug: "dlsite", voiceActorId: "va_ueda-reina" },
      "POST /api/admin/ingest が HTTP 400",
    );
    expect(report.works).toEqual([]);
    expect(report.error).toBe("POST /api/admin/ingest が HTTP 400");
    expect(report.runId).toBe("2026-09-18-dlsite-ueda-reina");
    expect(report.voiceActorId).toBe("va_ueda-reina");
  });

  it("今の protocolVersion を載せる", () => {
    // 失敗の記録そのものが版ずれで弾かれては意味がない
    expect(
      failureReport({ runId: "r", storeSlug: "audible", voiceActorId: "va_a" }, "理由")
        .protocolVersion,
    ).toBe(INGEST_PROTOCOL_VERSION);
  });

  it("長い理由は 500 文字に切り詰める", () => {
    // zod の issue 一覧がそのまま入ることがある。管理画面に出る 1 行なので抑える
    const report = failureReport(
      { runId: "r", storeSlug: "dlsite", voiceActorId: "va_a" },
      "あ".repeat(2000),
    );
    expect(report.error).toHaveLength(500);
  });
});
