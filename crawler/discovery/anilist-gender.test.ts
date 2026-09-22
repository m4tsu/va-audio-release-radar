import { readFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchResult } from "../lib/fetch.ts";
import { FIXTURES_DIR } from "../lib/paths.ts";
import type { ActorGenderCache, GenderTarget } from "./actor-gender.ts";
import {
  batches,
  crawlActorGender,
  fetchGenderBatch,
  loadActorTargets,
  loadStaffTargets,
  parseStaffGenderPage,
  recordsForBatch,
  summarizeRecords,
  targetsWithoutGender,
} from "./anilist-gender.ts";

// 停止条件と結果の残り方だけをネットワーク無しで確かめるための差し替え。
// 応答の解析そのものはフィクスチャに対するテスト (このファイルの parseStaffGenderPage) が見ている
vi.mock("../lib/fetch.ts", () => ({
  fetchText: vi.fn(),
  rateLimitFor: () => ({ key: "anilist", intervalMs: 3_000 }),
}));
const { fetchText } = await import("../lib/fetch.ts");
const fetchTextMock = vi.mocked(fetchText);

const FIXTURE = readFileSync(path.join(FIXTURES_DIR, "anilist-staff-gender.json"), "utf8");

function ok(body: string): FetchResult {
  return { ok: true, status: 200, url: "https://graphql.anilist.co", body };
}

function ng(status: number): FetchResult {
  return {
    ok: false,
    status,
    url: "https://graphql.anilist.co",
    reason: `HTTP ${status}`,
  };
}

function target(anilistStaffId: number, canonicalName: string): GenderTarget {
  return { anilistStaffId, canonicalName };
}

function emptyCache(): ActorGenderCache {
  return {
    startedAt: "2026-09-22T00:00:00.000Z",
    updatedAt: "2026-09-22T00:00:00.000Z",
    records: [],
  };
}

beforeEach(() => {
  fetchTextMock.mockReset();
});

describe("parseStaffGenderPage", () => {
  it("staff id ごとに生の値と列挙に写した値を取り出す", () => {
    const entries = parseStaffGenderPage(JSON.parse(FIXTURE));
    expect(entries.get(95002)).toEqual({
      anilistStaffId: 95002,
      gender: "male",
      rawGender: "Male",
      nativeName: "杉田智和",
    });
  });

  it("gender が null の staff は性別を持たない行になる", () => {
    const entries = parseStaffGenderPage(JSON.parse(FIXTURE));
    expect(entries.get(120263)).toEqual({
      anilistStaffId: 120263,
      nativeName: "濱野大輝",
    });
  });

  it("応答の形が違えば空", () => {
    expect(parseStaffGenderPage({ data: null }).size).toBe(0);
    expect(parseStaffGenderPage("<html>").size).toBe(0);
  });
});

describe("recordsForBatch", () => {
  const entries = parseStaffGenderPage(JSON.parse(FIXTURE));
  const fetchedAt = "2026-09-22T00:00:00.000Z";

  it("性別が返った人は ok", () => {
    expect(recordsForBatch([target(95002, "杉田智和")], entries, fetchedAt)).toEqual([
      {
        anilistStaffId: 95002,
        canonicalName: "杉田智和",
        status: "ok",
        gender: "male",
        rawGender: "Male",
        nativeName: "杉田智和",
        fetchedAt,
      },
    ]);
  });

  it("問い合わせたが値を持たない人は absent (「まだ聞いていない」と区別する)", () => {
    const [record] = recordsForBatch([target(120263, "濱野大輝")], entries, fetchedAt);
    expect(record?.status).toBe("absent");
    expect(record?.gender).toBeUndefined();
  });

  it("応答に居ない staff id は not-found", () => {
    const [record] = recordsForBatch([target(999999, "居ない人")], entries, fetchedAt);
    expect(record?.status).toBe("not-found");
  });

  it("GraphQL エラーのときは、応答に居ない staff id を not-found にせず failed にする", () => {
    const [record] = recordsForBatch([target(999999, "居ない人")], entries, fetchedAt, "Too Many");
    expect(record?.status).toBe("failed");
    expect(record?.reason).toContain("Too Many");
  });

  it("1 人も返らない応答は、全員 not-found にせず failed にする (引き直せるようにする)", () => {
    const records = recordsForBatch(
      [target(95002, "杉田智和"), target(120263, "濱野大輝")],
      new Map(),
      fetchedAt,
    );
    expect(records.map((record) => record.status)).toEqual(["failed", "failed"]);
  });
});

describe("targetsWithoutGender", () => {
  it("性別が付いていない声優だけを返す", () => {
    expect(
      targetsWithoutGender([
        { anilistStaffId: 1, canonicalName: "不明の人", gender: "unknown" },
        { anilistStaffId: 2, canonicalName: "性別の無い行", gender: undefined },
        { anilistStaffId: 3, canonicalName: "女性の人", gender: "female" },
        { anilistStaffId: 4, canonicalName: "その他の人", gender: "other" },
      ]),
    ).toEqual([
      { anilistStaffId: 1, canonicalName: "不明の人" },
      { anilistStaffId: 2, canonicalName: "性別の無い行" },
    ]);
  });

  it("staff id か名前が無い行は引きようがないので落とす", () => {
    expect(
      targetsWithoutGender([
        { anilistStaffId: undefined, canonicalName: "id の無い人" },
        { anilistStaffId: 5, canonicalName: undefined },
      ]),
    ).toEqual([]);
  });
});

describe("loadActorTargets", () => {
  it("ファイルが無ければ空 (リストなしでも staff 集計だけで引ける)", async () => {
    await expect(loadActorTargets(path.join(FIXTURES_DIR, "none.json"))).resolves.toEqual([]);
  });

  it("配列でないファイルは投げる (黙って 0 人として扱わない)", async () => {
    await expect(
      loadActorTargets(path.join(FIXTURES_DIR, "anilist-staff-gender.json")),
    ).rejects.toThrow(/配列ではない/);
  });
});

describe("loadStaffTargets", () => {
  it("ファイルが無ければ空 (staff 集計なしでも引ける)", async () => {
    await expect(loadStaffTargets(path.join(FIXTURES_DIR, "none.json"))).resolves.toEqual([]);
  });

  it("staff 配列を持たないファイルは投げる", async () => {
    await expect(
      loadStaffTargets(path.join(FIXTURES_DIR, "anilist-staff-gender.json")),
    ).rejects.toThrow(/staff 配列が無い/);
  });
});

describe("batches", () => {
  it("1 リクエストぶんずつに切る", () => {
    const targets = Array.from({ length: 120 }, (_, index) => target(index, `声優${index}`));
    expect(batches(targets).map((chunk) => chunk.length)).toEqual([50, 50, 20]);
  });
});

describe("fetchGenderBatch", () => {
  it("リクエストが失敗したら、その組の全員を failed にする", async () => {
    fetchTextMock.mockResolvedValue(ng(429));
    const records = await fetchGenderBatch([target(1, "A"), target(2, "B")], {});
    expect(records.map((record) => record.status)).toEqual(["failed", "failed"]);
    expect(records[0]?.httpStatus).toBe(429);
  });

  it("JSON として読めない応答も failed", async () => {
    fetchTextMock.mockResolvedValue(ok("<html>"));
    const records = await fetchGenderBatch([target(1, "A")], {});
    expect(records[0]?.status).toBe("failed");
  });

  it("1 リクエストに組の staff id をまとめて載せる", async () => {
    fetchTextMock.mockResolvedValue(ok(FIXTURE));
    await fetchGenderBatch([target(95002, "杉田智和"), target(120263, "濱野大輝")], {});
    expect(fetchTextMock).toHaveBeenCalledTimes(1);
    const body = fetchTextMock.mock.calls[0]?.[1]?.body ?? "{}";
    expect(JSON.parse(body).variables.ids).toEqual([95002, 120263]);
  });
});

describe("crawlActorGender", () => {
  async function outFile(): Promise<string> {
    return path.join(await mkdtemp(path.join(tmpdir(), "anilist-gender-")), "gender.json");
  }

  it("組ごとに結果を書き出す (途中で止まっても続きから再開できる)", async () => {
    fetchTextMock.mockResolvedValue(ok(FIXTURE));
    const cache = emptyCache();
    const file = await outFile();
    const { stop } = await crawlActorGender({
      targets: [target(95002, "杉田智和"), target(120263, "濱野大輝")],
      cache,
      outFile: file,
    });
    expect(stop).toBeUndefined();
    expect(summarizeRecords(cache.records)).toMatchObject({ ok: 1, absent: 1, total: 2 });
    const written = JSON.parse(await readFile(file, "utf8"));
    expect(written.records).toHaveLength(2);
  });

  it("429 はその場で止める (相手が拒んでいる合図)", async () => {
    fetchTextMock.mockResolvedValue(ng(429));
    const { stop } = await crawlActorGender({
      targets: [target(1, "A")],
      cache: emptyCache(),
      outFile: await outFile(),
    });
    expect(stop?.kind).toBe("rate-limited");
  });

  it("403 もその場で止める", async () => {
    fetchTextMock.mockResolvedValue(ng(403));
    const { stop } = await crawlActorGender({
      targets: [target(1, "A")],
      cache: emptyCache(),
      outFile: await outFile(),
    });
    expect(stop?.kind).toBe("forbidden");
  });

  it("失敗が続けば止める", async () => {
    fetchTextMock.mockResolvedValue(ng(500));
    const targets = Array.from({ length: 200 }, (_, index) => target(index, `声優${index}`));
    const { stop } = await crawlActorGender({
      targets,
      cache: emptyCache(),
      outFile: await outFile(),
    });
    expect(stop?.kind).toBe("consecutive-failures");
    // 打ち切った時点までしか引かない (4 組目には進まない)
    expect(fetchTextMock).toHaveBeenCalledTimes(3);
  });
});
