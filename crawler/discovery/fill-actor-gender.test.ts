import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ActorEntity } from "./actor-entity.ts";
import type { ActorGenderCache, ActorGenderRecord } from "./actor-gender.ts";
import { fillGender, loadActors, main, nameMismatches } from "./fill-actor-gender.ts";

function actor(overrides: Partial<ActorEntity> = {}): ActorEntity {
  return {
    id: "va_ueda-reina",
    slug: "ueda-reina",
    canonicalName: "上田麗奈",
    nameKana: "うえだれいな",
    nameEn: "Reina Ueda",
    anilistStaffId: 118602,
    status: "active",
    gender: "unknown",
    aliases: [{ name: "上田 麗奈", source: "manual", verified: false }],
    ...overrides,
  };
}

describe("fillGender", () => {
  it("「不明」の行に取得した性別を書き入れる", () => {
    const result = fillGender([actor()], { 118602: "female" });
    expect(result.actors[0]?.gender).toBe("female");
    expect(result.filled).toEqual([{ canonicalName: "上田麗奈", gender: "female" }]);
  });

  it("性別以外の欄には触らない", () => {
    const before = actor();
    const [after] = fillGender([before], { 118602: "female" }).actors;
    expect(after).toEqual({ ...before, gender: "female" });
    // 欄の並びも変えない (書き戻した JSON の差分を gender の行だけに保つため)
    expect(Object.keys(after ?? {})).toEqual(Object.keys(before));
  });

  it("既に性別が付いている行は書き換えない", () => {
    const result = fillGender([actor({ gender: "male" })], { 118602: "female" });
    expect(result.actors[0]?.gender).toBe("male");
    expect(result.filled).toEqual([]);
  });

  it("「その他」の行も書き換えない", () => {
    const result = fillGender([actor({ gender: "other" })], { 118602: "female" });
    expect(result.actors[0]?.gender).toBe("other");
  });

  it("取得結果に居ない人は「不明」のまま残る", () => {
    const result = fillGender([actor()], { 999999: "female" });
    expect(result.actors[0]?.gender).toBe("unknown");
    expect(result.remainingUnknown).toBe(1);
  });

  it("人数と並びを変えない", () => {
    const actors = [
      actor(),
      actor({ canonicalName: "梶裕貴", anilistStaffId: 95069, gender: "male" }),
      actor({ canonicalName: "ゆかな", anilistStaffId: 95151 }),
    ];
    const result = fillGender(actors, { 118602: "female", 95151: "female" });
    expect(result.actors).toHaveLength(3);
    expect(result.actors.map((entry) => entry.canonicalName)).toEqual([
      "上田麗奈",
      "梶裕貴",
      "ゆかな",
    ]);
  });
});

describe("nameMismatches", () => {
  function record(overrides: Partial<ActorGenderRecord> = {}): ActorGenderRecord {
    return {
      anilistStaffId: 118602,
      canonicalName: "上田麗奈",
      status: "ok",
      gender: "female",
      nativeName: "上田麗奈",
      fetchedAt: "2026-09-22T00:00:00.000Z",
      ...overrides,
    };
  }

  it("staff id が同じで名前が違う声優を挙げる", () => {
    expect(nameMismatches([actor()], [record({ nativeName: "別の人" })])).toEqual([
      { anilistStaffId: 118602, listName: "上田麗奈", anilistName: "別の人" },
    ]);
  });

  it("名前が同じなら挙げない", () => {
    expect(nameMismatches([actor()], [record()])).toEqual([]);
  });

  it("AniList が名前を返していない記録は比べようがない", () => {
    expect(nameMismatches([actor()], [record({ nativeName: undefined })])).toEqual([]);
  });

  it("リストに居ない staff id は比べない", () => {
    expect(nameMismatches([actor()], [record({ anilistStaffId: 999999 })])).toEqual([]);
  });
});

describe("loadActors", () => {
  it("配列でないファイルは投げる (書き戻して形を壊さないため)", async () => {
    const file = path.join(await mkdtemp(path.join(tmpdir(), "fill-actor-gender-")), "actors.json");
    await writeFile(file, '{"actors": []}', "utf8");
    await expect(loadActors(file)).rejects.toThrow(/配列ではない/);
  });
});

describe("main", () => {
  async function workspace(
    actors: ActorEntity[],
    records: ActorGenderRecord[],
  ): Promise<{ actorsFile: string; genderFile: string; before: string }> {
    const directory = await mkdtemp(path.join(tmpdir(), "fill-actor-gender-"));
    const actorsFile = path.join(directory, "actors.generated.json");
    const genderFile = path.join(directory, "anilist-gender.json");
    // 生成 (build-actors.ts) が書く形をそのまま置く
    const before = `${JSON.stringify(actors, null, 2)}\n`;
    await writeFile(actorsFile, before, "utf8");
    const cache: ActorGenderCache = {
      startedAt: "2026-09-22T00:00:00.000Z",
      updatedAt: "2026-09-22T00:00:00.000Z",
      records,
    };
    await writeFile(genderFile, JSON.stringify(cache), "utf8");
    return { actorsFile, genderFile, before };
  }

  function okRecord(anilistStaffId: number, gender: "female" | "male"): ActorGenderRecord {
    return {
      anilistStaffId,
      canonicalName: "上田麗奈",
      status: "ok",
      gender,
      fetchedAt: "2026-09-22T00:00:00.000Z",
    };
  }

  it("書き戻したファイルで、変わる行は gender の行だけ", async () => {
    const { actorsFile, genderFile, before } = await workspace(
      [actor(), actor({ canonicalName: "梶裕貴", anilistStaffId: 95069, gender: "male" })],
      [okRecord(118602, "female")],
    );
    expect(await main(["--actors", actorsFile, "--gender", genderFile])).toBe(0);

    const afterLines = (await readFile(actorsFile, "utf8")).split("\n");
    const beforeLines = before.split("\n");
    expect(afterLines).toHaveLength(beforeLines.length);
    expect(afterLines.filter((line, index) => line !== beforeLines[index])).toEqual([
      '    "gender": "female",',
    ]);
  });

  it("書き入れるものが無ければファイルに触らない", async () => {
    const { actorsFile, genderFile, before } = await workspace([actor()], []);
    expect(await main(["--actors", actorsFile, "--gender", genderFile])).toBe(0);
    expect(await readFile(actorsFile, "utf8")).toBe(before);
  });

  it("--dry-run では書き戻さない", async () => {
    const { actorsFile, genderFile, before } = await workspace(
      [actor()],
      [okRecord(118602, "female")],
    );
    expect(await main(["--actors", actorsFile, "--gender", genderFile, "--dry-run"])).toBe(0);
    expect(await readFile(actorsFile, "utf8")).toBe(before);
  });

  it("取得結果が無ければ何もせずに失敗する", async () => {
    const { actorsFile } = await workspace([actor()], []);
    const missing = path.join(path.dirname(actorsFile), "none.json");
    expect(await main(["--actors", actorsFile, "--gender", missing])).toBe(1);
  });
});
