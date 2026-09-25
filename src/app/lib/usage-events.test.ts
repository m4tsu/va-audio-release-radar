import { describe, expect, it } from "vitest";
import { webAnalyticsScripts } from "./usage-events";

describe("webAnalyticsScripts", () => {
  /** dev・E2E・公開前のページビューを数えない */
  it("トークンが無ければ読み込まない", () => {
    expect(webAnalyticsScripts(null)).toEqual([]);
  });

  it("トークンを data-cf-beacon に入れて読み込む", () => {
    const [script] = webAnalyticsScripts("abc");

    expect(script?.src).toBe("https://static.cloudflareinsights.com/beacon.min.js");
    expect(JSON.parse(script?.["data-cf-beacon"] ?? "")).toEqual({ token: "abc" });
  });
});
