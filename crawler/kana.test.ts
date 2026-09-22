import { describe, expect, it } from "vitest";
import type { ActorKanaRecord } from "./discovery/actor-kana.ts";
import { describeMiss, toKanaResult } from "./kana.ts";

/**
 * 取得結果を台帳に送る形にするところ。
 *
 * 出どころを取り違えると、記事から取った値が Wikidata のものとして残る。
 * 取れなかった人を送らないと、次の週に同じ人を引き直す
 */

const TARGET = { id: "va_ueda-reina", canonicalName: "上田麗奈" };

function record(overrides: Partial<ActorKanaRecord> = {}): ActorKanaRecord {
  return {
    canonicalName: TARGET.canonicalName,
    status: "ok",
    kana: "うえだれいな",
    source: "furigana",
    fetchedAt: "2026-09-23T00:00:00.000Z",
    ...overrides,
  };
}

describe("toKanaResult", () => {
  it("記事から取ったものは、どの取り出し方でも wikipedia", () => {
    for (const source of ["furigana", "kana-name", "lead"] as const) {
      expect(toKanaResult(TARGET, record({ source }))).toEqual({
        voiceActorId: TARGET.id,
        kana: "うえだれいな",
        source: "wikipedia",
      });
    }
  });

  it("Wikidata の項目から取ったものは wikidata", () => {
    expect(toKanaResult(TARGET, record({ source: "wikidata" })).source).toBe("wikidata");
  });

  it("かなが取れなかった人は、引いた印だけが付く形にする", () => {
    for (const status of ["rejected", "not-found", "failed"] as const) {
      expect(toKanaResult(TARGET, record({ status, kana: undefined }))).toEqual({
        voiceActorId: TARGET.id,
      });
    }
  });

  it("status が ok でもかなが無ければ送らない", () => {
    expect(toKanaResult(TARGET, record({ kana: undefined }))).toEqual({
      voiceActorId: TARGET.id,
    });
  });
});

describe("describeMiss", () => {
  it("名前と理由を 1 行にする", () => {
    expect(describeMiss(TARGET, record({ status: "not-found", reason: "記事が無い" }))).toBe(
      "上田麗奈: 記事が無い",
    );
  });

  it("理由が無ければ状態を出す", () => {
    expect(describeMiss(TARGET, record({ status: "failed", reason: undefined }))).toBe(
      "上田麗奈: failed",
    );
  });
});
