import { describe, expect, it } from "vitest";
import type { StoreSlug } from "../src/domain/index.ts";
import type { AdapterStatus } from "./adapters/types.ts";
import type { ActorSeed } from "./lib/ingest.ts";
import {
  filterActors,
  formatOutcomeTable,
  loadActorSeeds,
  type RunOutcome,
  summarize,
} from "./run.ts";

/**
 * ネットワークに出る部分 (main) は単体テストしない。集計・整形・絞り込みだけを固定で押さえる。
 * `actors.json` は実際に配る値なので、形が崩れていないことをここで検出する
 */

const UEDA: ActorSeed = {
  id: "va_ueda-reina",
  slug: "ueda-reina",
  canonicalName: "上田麗奈",
};
const KAJI: ActorSeed = { id: "va_kaji-yuki", slug: "kaji-yuki", canonicalName: "梶裕貴" };

function outcome(
  actor: ActorSeed,
  storeSlug: StoreSlug,
  status: AdapterStatus,
  workCount = 0,
  newCount = 0,
  unmatchedCount = 0,
): RunOutcome {
  return { actor, storeSlug, status, workCount, newCount, unmatchedCount };
}

describe("summarize", () => {
  it("声優数と status ごとの件数、作品 / new / 未解決の合計を出す", () => {
    expect(
      summarize([
        outcome(UEDA, "dlsite", "ok", 30, 30, 4),
        outcome(UEDA, "audible", "empty"),
        outcome(KAJI, "dlsite", "ok", 12, 5, 1),
        outcome(KAJI, "audible", "error"),
      ]),
    ).toEqual({ actors: 2, ok: 2, empty: 1, error: 1, works: 42, new: 35, unmatched: 5 });
  });

  it("結果が無ければすべて 0", () => {
    expect(summarize([])).toEqual({
      actors: 0,
      ok: 0,
      empty: 0,
      error: 0,
      works: 0,
      new: 0,
      unmatched: 0,
    });
  });
});

describe("formatOutcomeTable", () => {
  it("声優ごとに 1 行にまとめ、ok 以外のストアを備考に出す", () => {
    const table = formatOutcomeTable([
      outcome(UEDA, "dlsite", "ok", 30, 7),
      outcome(UEDA, "audible", "empty"),
    ]);
    const lines = table.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^声優\s+DLsite\s+new\s+Audible\s+new\s+備考$/);
    expect(lines[1]).toMatch(/^上田麗奈\s+30\s+7\s+0\s+0\s+audible:empty$/);
  });

  it("対象から外したストアは 0 ではなく - にする", () => {
    const table = formatOutcomeTable([outcome(KAJI, "dlsite", "ok", 3, 3)]);
    expect(table.split("\n")[1]).toMatch(/^梶裕貴\s+3\s+3\s+-\s+-$/);
  });
});

describe("filterActors", () => {
  const actors = [UEDA, KAJI];

  it("指定が無ければ全員返す", () => {
    expect(filterActors(actors, undefined)).toEqual(actors);
  });

  it("canonicalName でも slug でも絞れる", () => {
    expect(filterActors(actors, "上田麗奈")).toEqual([UEDA]);
    expect(filterActors(actors, "kaji-yuki")).toEqual([KAJI]);
    expect(filterActors(actors, " 上田麗奈 , kaji-yuki ")).toEqual(actors);
  });

  it("どれにも当たらなければ空", () => {
    expect(filterActors(actors, "居ない人")).toEqual([]);
  });
});

describe("actors.json", () => {
  it("id は va_{slug} で、slug が重複しない", async () => {
    const seeds = await loadActorSeeds();
    expect(seeds.length).toBeGreaterThan(0);
    for (const seed of seeds) {
      expect(seed.id).toBe(`va_${seed.slug}`);
      expect(seed.slug).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(seed.canonicalName).not.toBe("");
      expect(seed.nameKana).toBeTruthy();
    }
    expect(new Set(seeds.map((seed) => seed.slug)).size).toBe(seeds.length);
  });

  it("全員に Audible 表記 (姓 名) の検証済み alias がある", async () => {
    // Audible は「上田 麗奈」のように姓名の間に空白を入れる。normalizeName でも吸収できるが、
    // 管理画面で表記揺れを確認できるよう明示的に持たせている
    for (const seed of await loadActorSeeds()) {
      const aliases = seed.aliases ?? [];
      expect(aliases.length).toBeGreaterThan(0);
      expect(aliases.some((alias) => alias.name.includes(" "))).toBe(true);
      for (const alias of aliases) {
        expect(alias.source).toBe("manual");
        expect(alias.verified).toBe(true);
      }
    }
  });
});
