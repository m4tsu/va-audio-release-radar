import { beforeAll, describe, expect, it, vi } from "vitest";
import { createPushSender, type PushTarget } from "./send";

/**
 * push service には出ない。fetch を差し替えて、組み立てた要求の形と、応答の読み分けを見る。
 * 鍵はテストごとに WebCrypto で作る (固定値を置くと鍵の形が変わったときに気づけない)
 */

function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Buffer.from(view).toString("base64url");
}

let vapid: { subject: string; publicKey: string; privateKey: string };
let target: PushTarget;

beforeAll(async () => {
  const server = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
  ]);
  const serverJwk = await crypto.subtle.exportKey("jwk", server.privateKey);
  vapid = {
    subject: "mailto:radar@example.com",
    publicKey: base64Url(await crypto.subtle.exportKey("raw", server.publicKey)),
    privateKey: serverJwk.d ?? "",
  };

  const client = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  target = {
    endpoint: "https://push.example/sub/1",
    p256dh: base64Url(await crypto.subtle.exportKey("raw", client.publicKey)),
    auth: base64Url(crypto.getRandomValues(new Uint8Array(16))),
  };
});

const MESSAGE = {
  title: "新作の音声作品 1 件",
  body: "上田麗奈の新作が出ました",
  url: "/following",
};

function fetchReturning(status: number) {
  return vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status }),
  );
}

describe("createPushSender", () => {
  it("暗号化した本文を VAPID の署名つきで endpoint へ POST し、2xx なら sent", async () => {
    const fetchFn = fetchReturning(201);
    const send = createPushSender(vapid, fetchFn as unknown as typeof fetch);

    const outcome = await send(target, MESSAGE);

    expect(outcome).toEqual({ kind: "sent" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe(target.endpoint);
    expect(init?.method?.toUpperCase()).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toMatch(/^vapid t=.+, k=.+/);
    expect(headers["content-encoding"]).toBe("aes128gcm");
    expect(headers.ttl).toBe(String(7 * 24 * 60 * 60));
    // Apple の push service は Topic ヘッダがあると拒む
    expect(headers.topic).toBeUndefined();
    // 本文は暗号化されている。平文の題名が入っていないことを見る
    expect(Buffer.from(init?.body as Uint8Array).toString("utf8")).not.toContain(MESSAGE.title);
  });

  it("404 と 410 は購読の失効として返す", async () => {
    for (const status of [404, 410]) {
      const send = createPushSender(vapid, fetchReturning(status) as unknown as typeof fetch);
      expect(await send(target, MESSAGE)).toEqual({ kind: "expired", status });
    }
  });

  it("5xx と 429 は一時的な失敗 (送り直す)", async () => {
    for (const status of [500, 503, 429]) {
      const send = createPushSender(vapid, fetchReturning(status) as unknown as typeof fetch);
      expect(await send(target, MESSAGE)).toEqual({ kind: "failed", permanent: false, status });
    }
  });

  /** 鍵の不一致や本文の拒否は、同じ内容を送り直しても通らない */
  it("404 / 410 / 429 以外の 4xx は恒久的な失敗 (この週は送り直さない)", async () => {
    for (const status of [400, 401, 403, 413]) {
      const send = createPushSender(vapid, fetchReturning(status) as unknown as typeof fetch);
      expect(await send(target, MESSAGE)).toEqual({ kind: "failed", permanent: true, status });
    }
  });

  it("拒まれたときは応答本文を理由として返す", async () => {
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ reason: "BadJwtToken" }), { status: 403 }),
    );
    const send = createPushSender(vapid, fetchFn as unknown as typeof fetch);
    expect(await send(target, MESSAGE)).toEqual({
      kind: "failed",
      permanent: true,
      status: 403,
      error: '{"reason":"BadJwtToken"}',
    });
  });

  it("通信そのものが失敗しても投げずに、一時的な失敗として返す", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("network down");
    });
    const send = createPushSender(vapid, fetchFn as unknown as typeof fetch);
    expect(await send(target, MESSAGE)).toEqual({
      kind: "failed",
      permanent: false,
      error: "network down",
    });
  });

  /** 鍵の欠けは送る前に分かる。fetch に出ない */
  it("VAPID の鍵が無ければ fetch せずに失敗として返す", async () => {
    const fetchFn = fetchReturning(201);
    const send = createPushSender({ ...vapid, privateKey: "" }, fetchFn as unknown as typeof fetch);
    const outcome = await send(target, MESSAGE);
    expect(outcome.kind).toBe("failed");
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
