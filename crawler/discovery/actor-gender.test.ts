import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ActorGenderRecord,
  genderByStaffId,
  pendingTargets,
  queriedStaffIds,
  readGenderCache,
} from "./actor-gender.ts";

function record(overrides: Partial<ActorGenderRecord> = {}): ActorGenderRecord {
  return {
    anilistStaffId: 118602,
    canonicalName: "上田麗奈",
    status: "ok",
    gender: "female",
    rawGender: "Female",
    fetchedAt: "2026-09-22T00:00:00.000Z",
    ...overrides,
  };
}

describe("genderByStaffId", () => {
  it("性別が返った人だけを staff id で引ける形にする", () => {
    expect(
      genderByStaffId([
        record(),
        record({ anilistStaffId: 95002, canonicalName: "杉田智和", gender: "male" }),
        record({
          anilistStaffId: 120263,
          canonicalName: "濱野大輝",
          status: "absent",
          gender: undefined,
          rawGender: undefined,
        }),
        record({
          anilistStaffId: 1,
          canonicalName: "居ない人",
          status: "not-found",
          gender: undefined,
        }),
        record({
          anilistStaffId: 2,
          canonicalName: "失敗した人",
          status: "failed",
          gender: undefined,
        }),
      ]),
    ).toEqual({ 118602: "female", 95002: "male" });
  });

  it("status が ok でも性別が無ければ入れない", () => {
    expect(genderByStaffId([record({ gender: undefined })])).toEqual({});
  });
});

describe("queriedStaffIds", () => {
  it("値を持たなかった人・staff が返らなかった人も問い合わせ済みとして数える", () => {
    const ids = queriedStaffIds([
      record(),
      record({ anilistStaffId: 120263, status: "absent", gender: undefined }),
      record({ anilistStaffId: 1, status: "not-found", gender: undefined }),
    ]);
    expect([...ids].sort((a, b) => a - b)).toEqual([1, 118602, 120263]);
  });

  it("取得に失敗した人は問い合わせ済みにしない (相手の答えを受け取れていない)", () => {
    expect(queriedStaffIds([record({ status: "failed", gender: undefined })]).size).toBe(0);
  });
});

describe("readGenderCache", () => {
  it("ファイルがまだ無ければ undefined", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "actor-gender-"));
    await expect(readGenderCache(path.join(directory, "none.json"))).resolves.toBeUndefined();
  });

  it("壊れた JSON は投げる (黙って最初から引き直さない)", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "actor-gender-"));
    const file = path.join(directory, "broken.json");
    await writeFile(file, '{"records": [', "utf8");
    await expect(readGenderCache(file)).rejects.toThrow(/JSON として読めない/);
  });

  it("records を持たない JSON も投げる", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "actor-gender-"));
    const file = path.join(directory, "shape.json");
    await writeFile(file, '{"startedAt": "2026-09-22T00:00:00.000Z"}', "utf8");
    await expect(readGenderCache(file)).rejects.toThrow(/records 配列が無い/);
  });
});

describe("pendingTargets", () => {
  const targets = [
    { anilistStaffId: 118602, canonicalName: "上田麗奈" },
    { anilistStaffId: 95002, canonicalName: "杉田智和" },
    { anilistStaffId: 120263, canonicalName: "濱野大輝" },
  ];

  it("問い合わせ済みの人を飛ばす (値を持たなかった人も引き直さない)", () => {
    expect(
      pendingTargets(targets, [
        record(),
        record({ anilistStaffId: 95002, status: "absent", gender: undefined }),
      ]),
    ).toEqual([{ anilistStaffId: 120263, canonicalName: "濱野大輝" }]);
  });

  it("取得に失敗した人は引き直す (続きから再開したときに取り残さない)", () => {
    expect(
      pendingTargets(targets, [
        record(),
        record({ anilistStaffId: 95002, status: "failed", gender: undefined }),
        record({ anilistStaffId: 120263, status: "not-found", gender: undefined }),
      ]),
    ).toEqual([{ anilistStaffId: 95002, canonicalName: "杉田智和" }]);
  });

  it("同じ staff id が 2 回来ても 1 回だけ引く", () => {
    const duplicated = [...targets, { anilistStaffId: 118602, canonicalName: "上田麗奈" }];
    expect(pendingTargets(duplicated, [])).toHaveLength(3);
  });

  it("limit で切る", () => {
    expect(pendingTargets(targets, [], 2)).toHaveLength(2);
  });
});
