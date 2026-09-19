import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { INGEST_PROTOCOL_VERSION, type StoreSlug } from "../src/domain/index.ts";
import type { AdapterResult, AdapterStatus } from "./adapters/types.ts";
import { type ActorSeed, AdminApiClient, IngestProtocolMismatchError } from "./lib/ingest.ts";
import { CRAWLER_DIR } from "./lib/paths.ts";
import {
  buildSearchNames,
  filterActors,
  formatOutcomeTable,
  loadActorSeeds,
  type RunOutcome,
  send,
  sliceActors,
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

/** 保存まで成功した 1 行。workCount は保存された件数なので fetchedCount と同じになる */
function outcome(
  actor: ActorSeed,
  storeSlug: StoreSlug,
  status: AdapterStatus,
  workCount = 0,
  newCount = 0,
  unmatchedCount = 0,
  queryUsed?: string,
): RunOutcome {
  return {
    actor,
    storeSlug,
    status,
    fetchedCount: workCount,
    workCount,
    newCount,
    unmatchedCount,
    queryUsed,
    save: "saved",
  };
}

/** 取得はできたが ingest への送信に失敗した 1 行 (T16) */
function saveFailed(
  actor: ActorSeed,
  storeSlug: StoreSlug,
  fetchedCount: number,
  failureRecorded: boolean,
): RunOutcome {
  return {
    actor,
    storeSlug,
    status: "ok",
    fetchedCount,
    workCount: 0,
    newCount: 0,
    unmatchedCount: 0,
    reason: "POST /api/admin/ingest が HTTP 400",
    save: "failed",
    failureRecorded,
  };
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
    ).toEqual({
      actors: 2,
      ok: 2,
      empty: 1,
      error: 1,
      fetched: 42,
      works: 42,
      new: 35,
      unmatched: 5,
      saved: 4,
      saveFailed: 0,
      saveFailedUnrecorded: 0,
    });
  });

  it("結果が無ければすべて 0", () => {
    expect(summarize([])).toEqual({
      actors: 0,
      ok: 0,
      empty: 0,
      error: 0,
      fetched: 0,
      works: 0,
      new: 0,
      unmatched: 0,
      saved: 0,
      saveFailed: 0,
      saveFailedUnrecorded: 0,
    });
  });

  it("取得できたのに保存に失敗した件数を、取得成功と別に数える (T16)", () => {
    // 取得は 3 件とも成功しているが、保存まで届いたのは 1 件だけ。
    // これを「取得 3 成功」だけで報告したのが前回の事故
    const summary = summarize([
      outcome(UEDA, "dlsite", "ok", 30, 30, 4),
      saveFailed(UEDA, "audible", 7, true),
      saveFailed(KAJI, "dlsite", 12, false),
    ]);
    expect(summary.ok).toBe(3);
    expect(summary.fetched).toBe(49);
    // 保存できた作品だけを works として数える
    expect(summary.works).toBe(30);
    expect(summary.saved).toBe(1);
    expect(summary.saveFailed).toBe(2);
    expect(summary.saveFailedUnrecorded).toBe(1);
  });

  it("--dry-run の skipped は保存の成功にも失敗にも数えない", () => {
    const summary = summarize([{ ...outcome(UEDA, "dlsite", "ok", 30, 30, 4), save: "skipped" }]);
    expect(summary.saved).toBe(0);
    expect(summary.saveFailed).toBe(0);
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

  it("取得できたのに保存に失敗したストアを備考に出す (T16)", () => {
    // status は ok のままなので、備考に出さないと 0 件だった声優と見分けが付かない
    const table = formatOutcomeTable([saveFailed(UEDA, "dlsite", 12, true)]);
    expect(table.split("\n")[1]).toContain("dlsite:save-failed");
  });

  it("失敗を crawl_runs にも残せなかったときは備考でそう書く (T16)", () => {
    const table = formatOutcomeTable([saveFailed(UEDA, "audible", 12, false)]);
    expect(table.split("\n")[1]).toContain("audible:save-failed(未記録)");
  });
});

describe("sliceActors", () => {
  const actors = [UEDA, KAJI];

  it("指定が無ければ全員返す", () => {
    expect(sliceActors(actors, undefined, undefined)).toEqual(actors);
  });

  it("--offset は先頭から飛ばす", () => {
    expect(sliceActors(actors, 1, undefined)).toEqual([KAJI]);
  });

  it("--limit は offset を適用した後の人数として数える", () => {
    // 「81 人目から 420 人」を --offset 80 --limit 420 で書けるようにするため
    const five = [UEDA, KAJI, UEDA, KAJI, UEDA];
    expect(sliceActors(five, 2, 2)).toEqual([five[2], five[3]]);
  });

  it("offset 0 は先頭からと同じ", () => {
    expect(sliceActors(actors, 0, 1)).toEqual([UEDA]);
  });

  it("offset が人数を超えたら空", () => {
    expect(sliceActors(actors, 5, 10)).toEqual([]);
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

describe("send (取り込み失敗の可視化, T16)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const RESULT: AdapterResult = {
    storeSlug: "dlsite",
    actorName: "上田麗奈",
    status: "ok",
    works: [],
    invalidCount: 0,
    warnings: [],
  };

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status });
  }

  function bodyOf(call: unknown): Record<string, unknown> {
    const init = (call as [string, RequestInit])[1];
    return JSON.parse(String(init.body)) as Record<string, unknown>;
  }

  it("今の protocolVersion を載せて送る", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ upserted: 3, new: 3, unmatched: 0, skippedByRating: 0 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await send(
      new AdminApiClient("http://x", "dev"),
      UEDA,
      "dlsite",
      RESULT,
      "2026-09-18",
    );

    expect(bodyOf(fetchMock.mock.calls[0]).protocolVersion).toBe(INGEST_PROTOCOL_VERSION);
    expect(outcome.save).toBe("saved");
    expect(outcome.workCount).toBe(3);
  });

  it("POST が失敗したら失敗ペイロードを送り直して crawl_runs に残す", async () => {
    // 前回の事故では失敗が DB に残らず、管理画面から 0 件の声優と区別が付かなかった
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "payload が不正" }, 400))
      .mockResolvedValueOnce(
        jsonResponse({ upserted: 0, new: 0, unmatched: 0, skippedByRating: 0 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);

    const outcome = await send(
      new AdminApiClient("http://x", "dev"),
      UEDA,
      "dlsite",
      { ...RESULT, works: [{} as never, {} as never] },
      "2026-09-18",
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retry = bodyOf(fetchMock.mock.calls[1]);
    // 元の payload そのものが原因でありうるので、作品は載せずに error だけを送る
    expect(retry.works).toEqual([]);
    expect(String(retry.error)).toContain("HTTP 400");
    expect(retry.runId).toBe("2026-09-18-dlsite-ueda-reina");

    expect(outcome.save).toBe("failed");
    expect(outcome.failureRecorded).toBe(true);
    // 取得はできていたことを残す。保存された件数は 0
    expect(outcome.fetchedCount).toBe(2);
    expect(outcome.workCount).toBe(0);
    // status は adapter の結果のまま。取得失敗と保存失敗を混ぜない
    expect(outcome.status).toBe("ok");
  });

  it("失敗ペイロードも送れなければ failureRecorded を false にする", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "payload が不正" }, 400))
      .mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);

    vi.useFakeTimers();
    const promise = send(
      new AdminApiClient("http://x", "dev"),
      UEDA,
      "dlsite",
      RESULT,
      "2026-09-18",
    );
    await vi.runAllTimersAsync();
    const outcome = await promise;

    expect(outcome.save).toBe("failed");
    expect(outcome.failureRecorded).toBe(false);
    // 「DB に記録できなかった失敗」として最終集計に出る
    expect(summarize([outcome]).saveFailedUnrecorded).toBe(1);
  });

  it("409 は握り潰さずに投げ、走行を止められるようにする", async () => {
    // その 1 件を諦めて次に進むと、残り全員ぶんも同じように捨てることになる
    const fetchMock = vi.fn(async () => jsonResponse({ error: "クローラーが古い" }, 409));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      send(new AdminApiClient("http://x", "dev"), UEDA, "dlsite", RESULT, "2026-09-18"),
    ).rejects.toThrow(IngestProtocolMismatchError);
    // 失敗ペイロードの送り直しもしない (それも 409 になる)
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("--dry-run では送らず save を skipped にする", async () => {
    const outcome = await send(undefined, UEDA, "dlsite", RESULT, "2026-09-18");
    expect(outcome.save).toBe("skipped");
  });
});
