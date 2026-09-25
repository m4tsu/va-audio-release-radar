import { describe, expect, it } from "vitest";
import { INGEST_PROTOCOL_VERSION } from "@/contract";
import { requireIngestProtocolVersion } from "./protocol";

/**
 * 版の検査だけを見る。ルート全体 (`src/app/routes/api/admin/ingest.ts`) は
 * `cloudflare:workers` の env を要求するのでここでは通さない
 */

describe("requireIngestProtocolVersion", () => {
  it("版が一致すれば null を返し、処理を続けさせる", () => {
    expect(
      requireIngestProtocolVersion({ protocolVersion: INGEST_PROTOCOL_VERSION, works: [] }),
    ).toBeNull();
  });

  it("版が古ければ 409 を返す", async () => {
    // 400 ではなく 409 なのは、クローラーに「その 1 件を諦める」ではなく
    // 「走行ごと止まる」を選ばせるため
    const response = requireIngestProtocolVersion({ protocolVersion: 1 }, 2);
    expect(response?.status).toBe(409);

    const body = (await response?.json()) as {
      error: string;
      expectedProtocolVersion: number;
      receivedProtocolVersion: number | null;
    };
    expect(body.error).toContain("クローラーが古い");
    expect(body.error).toContain("再起動");
    expect(body.expectedProtocolVersion).toBe(2);
    expect(body.receivedProtocolVersion).toBe(1);
  });

  it("版が新しすぎる場合も 409 にする", () => {
    // サーバーだけ巻き戻ったときも取り込ませない。片方が古いことに変わりはない
    expect(requireIngestProtocolVersion({ protocolVersion: 5 }, 2)?.status).toBe(409);
  });

  it("protocolVersion が無い本文は 409 にする", async () => {
    // この仕組みが入る前のクローラー。素通りさせると古い形のペイロードが記録なしに捨てられる
    const response = requireIngestProtocolVersion({ runId: "run_1", works: [] }, 1);
    expect(response?.status).toBe(409);
    const body = (await response?.json()) as { receivedProtocolVersion: number | null };
    expect(body.receivedProtocolVersion).toBeNull();
  });

  it("本文がオブジェクトでなくても 500 にせず 409 にする", () => {
    expect(requireIngestProtocolVersion(null, 1)?.status).toBe(409);
    expect(requireIngestProtocolVersion("payload", 1)?.status).toBe(409);
  });
});
