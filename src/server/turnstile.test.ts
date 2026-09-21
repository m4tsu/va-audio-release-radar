import { afterEach, describe, expect, test, vi } from "vitest";
import { verifyTurnstile } from "./turnstile";

/** Cloudflare へは出ない。`fetch` を差し替えて、送った内容と結果の畳み方だけを見る */
function stubFetch(response: Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("verifyTurnstile", () => {
  test("success が true なら通す", async () => {
    const fetchMock = stubFetch(Response.json({ success: true }));

    await expect(verifyTurnstile("token", "secret")).resolves.toEqual({ ok: true });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(init.method).toBe("POST");
    const form = init.body as FormData;
    expect(form.get("secret")).toBe("secret");
    expect(form.get("response")).toBe("token");
    expect(form.get("remoteip")).toBeNull();
  });

  test("接続元の IP を渡せる", async () => {
    const fetchMock = stubFetch(Response.json({ success: true }));

    await verifyTurnstile("token", "secret", "203.0.113.1");

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.body as FormData).get("remoteip")).toBe("203.0.113.1");
  });

  test("success が false なら理由を添えて落とす", async () => {
    stubFetch(Response.json({ success: false, "error-codes": ["invalid-input-response"] }));

    await expect(verifyTurnstile("token", "secret")).resolves.toEqual({
      ok: false,
      errorCodes: ["invalid-input-response"],
    });
  });

  /** 空のトークンは Cloudflare に投げるまでもなく失敗する */
  test("トークンが空なら外に出ない", async () => {
    const fetchMock = stubFetch(Response.json({ success: true }));

    await expect(verifyTurnstile("", "secret")).resolves.toEqual({
      ok: false,
      errorCodes: ["missing-input-response"],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /** Cloudflare 側が落ちているときに「検証を通った」とは扱わない */
  test("検証エンドポイントが 5xx なら落とす", async () => {
    stubFetch(new Response("", { status: 502 }));

    await expect(verifyTurnstile("token", "secret")).resolves.toEqual({
      ok: false,
      errorCodes: ["http-502"],
    });
  });
});
