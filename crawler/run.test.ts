import path from "node:path";
import { describe, expect, it } from "vitest";
import type { StoreSlug } from "../src/domain/index.ts";
import type { AdapterStatus } from "./adapters/types.ts";
import type { ActorSeed } from "./lib/ingest.ts";
import { CRAWLER_DIR } from "./lib/paths.ts";
import {
  buildSearchNames,
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
  queryUsed?: string,
): RunOutcome {
  return { actor, storeSlug, status, workCount, newCount, unmatchedCount, queryUsed };
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

  it("空白入り別名で確定したときは queryUsed を備考に出す (T8)", () => {
    // status が ok でも canonicalName と違う語で確定したことは分かるようにする
    const table = formatOutcomeTable([
      outcome(UEDA, "audible", "ok", 7, 1, 0, "上田 麗奈"),
      outcome(UEDA, "dlsite", "ok", 30, 7, 0, "上田麗奈"),
    ]);
    expect(table.split("\n")[1]).toMatch(/^上田麗奈\s+30\s+7\s+7\s+1\s+audible:query=上田 麗奈$/);
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

describe("buildSearchNames", () => {
  it("空白入りの検証済み alias を canonicalName より先に置く", () => {
    // T8: Audible は「石見舞菜香」だと該当なしになり、「石見 舞菜香」だと見つかる
    expect(
      buildSearchNames({
        id: "va_iwami-manaka",
        slug: "iwami-manaka",
        canonicalName: "石見舞菜香",
        aliases: [{ name: "石見 舞菜香", source: "manual", verified: true }],
      }),
    ).toEqual(["石見 舞菜香", "石見舞菜香"]);
  });

  it("空白入り alias が無ければ canonicalName だけ", () => {
    expect(buildSearchNames(KAJI)).toEqual(["梶裕貴"]);
  });

  it("未検証の alias は canonicalName の後ろに置く", () => {
    // T13: 自動生成のリストは当てずっぽうの切り方で候補を持つ。adapter は 1 件でも取れたら
    // 打ち切るので、canonicalName を先に試せば大多数の声優で余分な検索が出ない
    expect(
      buildSearchNames({
        ...UEDA,
        aliases: [
          { name: "上田 麗奈", source: "manual", verified: false },
          { name: "上田麗 奈", source: "manual", verified: false },
        ],
      }),
    ).toEqual(["上田麗奈", "上田 麗奈", "上田麗 奈"]);
  });

  it("検証済みがあれば未検証の候補は使わない", () => {
    expect(
      buildSearchNames({
        ...UEDA,
        aliases: [
          { name: "上田 麗奈", source: "manual", verified: true },
          { name: "上田麗 奈", source: "manual", verified: false },
        ],
      }),
    ).toEqual(["上田 麗奈", "上田麗奈"]);
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

/**
 * 自動生成された対象声優リスト (T13)。`crawler/discovery/build-actors.ts` の出力で、
 * 生成元の `.cache/discovery/anilist-staff.json` はリポジトリに入らないので
 * 生成物のほうを検証する。ここが崩れたら ingest の zod が全件を弾く
 */
describe("actors.generated.json", () => {
  const GENERATED = path.join(CRAWLER_DIR, "actors.generated.json");

  it("id は va_{slug} で、slug が重複しない", async () => {
    const seeds = await loadActorSeeds(GENERATED);
    expect(seeds.length).toBeGreaterThan(2000);
    for (const seed of seeds) {
      expect(seed.id).toBe(`va_${seed.slug}`);
      // 衝突を人手で解いた slug には AniList の staff id が付くので数字も許す
      expect(seed.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(seed.canonicalName).not.toBe("");
    }
    expect(new Set(seeds.map((seed) => seed.slug)).size).toBe(seeds.length);
  });

  it("空白入り候補が無いのは fullName が 1 語の芸名だけ", async () => {
    // 2 文字以上の姓名を持つ声優は文字数に応じた切り方 (T14) で必ず候補が付く。
    // 候補が付かないのは「ゆかな」「麦人」「KENN」のように fullName が 1 語で
    // 姓と名の境界が無い芸名の人だけ。この集合は build-actors.ts の no-slug 除外だった
    // 68 人と一致するので、大きく増えたら生成規則の劣化を疑う
    const withoutCandidate: string[] = [];
    for (const seed of await loadActorSeeds(GENERATED)) {
      if (buildSearchNames(seed).some((name) => name.includes(" "))) continue;
      withoutCandidate.push(seed.canonicalName);
    }
    expect(withoutCandidate.length).toBeLessThanOrEqual(70);
  });
});
