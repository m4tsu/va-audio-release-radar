import { onTestFinished, vi } from "vitest";

/**
 * `navigator.sendBeacon` を差し替え、`/api/event` へ送られた本文を読めるようにする。
 * jsdom は sendBeacon を持たない。差し替えはそのテストの終わりに外す
 */
export function captureUsageEvents(): { sent: () => Promise<unknown[]> } {
  const bodies: Blob[] = [];
  const beacon = vi.fn((url: string, data: Blob) => {
    if (url === "/api/event") bodies.push(data);
    return true;
  });
  Object.defineProperty(navigator, "sendBeacon", {
    value: beacon,
    configurable: true,
    writable: true,
  });
  onTestFinished(() => {
    Reflect.deleteProperty(navigator, "sendBeacon");
  });
  return {
    sent: () => Promise.all(bodies.map(async (body) => JSON.parse(await body.text()))),
  };
}
