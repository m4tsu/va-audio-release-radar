import { describe, expect, it } from "vitest";
import { handleUsageEvent, webAnalyticsToken } from "./usage-events";

function fakeDataset() {
  const points: AnalyticsEngineDataPoint[] = [];
  const dataset: AnalyticsEngineDataset = {
    writeDataPoint: (point) => void points.push(point ?? {}),
  };
  return { dataset, points };
}

function post(body: string): Request {
  return new Request("https://example.com/api/event", { method: "POST", body });
}

describe("webAnalyticsToken", () => {
  it("空と未設定は計測しない", () => {
    expect(webAnalyticsToken(undefined)).toBeNull();
    expect(webAnalyticsToken("")).toBeNull();
    expect(webAnalyticsToken("  ")).toBeNull();
    expect(webAnalyticsToken(" abc ")).toBe("abc");
  });
});

describe("handleUsageEvent", () => {
  it("操作の種類とストアだけを書く", async () => {
    const { dataset, points } = fakeDataset();

    const store = await handleUsageEvent(post('{"type":"store_click","store":"dlsite"}'), {
      enabled: true,
      dataset,
    });
    const follow = await handleUsageEvent(post('{"type":"follow"}'), { enabled: true, dataset });

    expect(store.status).toBe(204);
    expect(follow.status).toBe(204);
    expect(points).toEqual([
      { blobs: ["store_click", "dlsite"], indexes: ["store_click"] },
      { blobs: ["follow", ""], indexes: ["follow"] },
    ]);
  });

  /** 送る側の誤りで声優 ID などが付いてきても、保存せずに捨てる */
  it("知らない項目が付いた本文は書かない", async () => {
    const { dataset, points } = fakeDataset();

    const response = await handleUsageEvent(post('{"type":"follow","voiceActorId":"a1"}'), {
      enabled: true,
      dataset,
    });

    expect(response.status).toBe(400);
    expect(points).toEqual([]);
  });

  it("知らない種類・知らないストア・JSON でない本文・長すぎる本文は書かない", async () => {
    const { dataset, points } = fakeDataset();
    const bodies = [
      '{"type":"unfollow"}',
      '{"type":"store_click","store":"amazon"}',
      '{"type":"store_click"}',
      "not json",
      JSON.stringify({ type: "follow", pad: "x".repeat(300) }),
    ];

    for (const body of bodies) {
      const response = await handleUsageEvent(post(body), { enabled: true, dataset });
      expect(response.status).toBe(400);
    }
    expect(points).toEqual([]);
  });

  /** 認可の無い経路なので、上限を超えた本文を読み切らない */
  it("上限を超える本文は、長さを申告していなくても途中で読むのをやめる", async () => {
    const { dataset, points } = fakeDataset();
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 100) controller.close();
        else controller.enqueue(new Uint8Array(100));
      },
    });
    const request = new Request("https://example.com/api/event", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit);

    const response = await handleUsageEvent(request, { enabled: true, dataset });

    expect(response.status).toBe(400);
    expect(pulled).toBeLessThan(10);
    expect(points).toEqual([]);
  });

  it("計測が無効なら何も書かない", async () => {
    const { dataset, points } = fakeDataset();

    const response = await handleUsageEvent(post('{"type":"follow"}'), { enabled: false, dataset });

    expect(response.status).toBe(204);
    expect(points).toEqual([]);
  });
});
