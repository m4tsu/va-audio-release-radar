import { describe, expect, it } from "vitest";
import type { ActorKanaRecord } from "./actor-kana.ts";
import { buildKanaSeeds, toAttributeSource } from "./write-actor-kana.ts";

/**
 * 取得したかなを台帳へ送る形にするところ。
 *
 * 出どころを間違えると、人が書いた訂正と取得した値がどちらも同じ行に入り、
 * 片方が消えるようになる。そこだけを固定する
 */

function record(overrides: Partial<ActorKanaRecord> = {}): ActorKanaRecord {
  return {
    canonicalName: "上田麗奈",
    status: "ok",
    kana: "うえだれいな",
    source: "furigana",
    fetchedAt: "2026-09-22T00:00:00.000Z",
    ...overrides,
  };
}

const ACTORS = new Map([
  ["上田麗奈", "va_ueda-reina"],
  ["花澤香菜", "va_hanazawa-kana"],
]);

describe("toAttributeSource", () => {
  it("記事から取ったものはどの取り出し方でも wikipedia にまとめる", () => {
    expect(toAttributeSource("furigana")).toBe("wikipedia");
    expect(toAttributeSource("kana-name")).toBe("wikipedia");
    expect(toAttributeSource("lead")).toBe("wikipedia");
  });

  it("Wikidata は別の情報源なので分ける", () => {
    expect(toAttributeSource("wikidata")).toBe("wikidata");
  });

  it("出どころが無い記録も記事として扱う", () => {
    expect(toAttributeSource(undefined)).toBe("wikipedia");
  });
});

describe("buildKanaSeeds", () => {
  it("かなが取れた記録を、声優 ID を引いて送る形にする", () => {
    const { seeds } = buildKanaSeeds([record()], ACTORS);

    expect(seeds).toEqual([
      {
        voiceActorId: "va_ueda-reina",
        attribute: "nameKana",
        source: "wikipedia",
        value: "うえだれいな",
      },
    ]);
  });

  it("かなが取れなかった記録は送らない", () => {
    const { seeds } = buildKanaSeeds(
      [
        record({ status: "not-found", kana: undefined }),
        record({ status: "rejected", kana: undefined }),
        record({ status: "failed", kana: undefined }),
      ],
      ACTORS,
    );

    expect(seeds).toEqual([]);
  });

  it("台帳に居ない名前は送らずに数える", () => {
    const { seeds, unknownNames } = buildKanaSeeds(
      [record(), record({ canonicalName: "居ない人" })],
      ACTORS,
    );

    expect(seeds).toHaveLength(1);
    expect(unknownNames).toEqual(["居ない人"]);
  });

  it("Wikidata から取った記録は出どころが分かれる", () => {
    const { seeds } = buildKanaSeeds(
      [record({ canonicalName: "花澤香菜", kana: "はなざわかな", source: "wikidata" })],
      ACTORS,
    );

    expect(seeds[0]?.source).toBe("wikidata");
  });
});
