import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ActorEntity } from "./actor-entity.ts";
import { genderLosses, kanaLosses } from "./build-actors.ts";

function actor(overrides: Partial<ActorEntity> = {}): ActorEntity {
  return {
    id: "va_ueda-reina",
    slug: "ueda-reina",
    canonicalName: "上田麗奈",
    nameKana: "うえだれいな",
    anilistStaffId: 118602,
    status: "active",
    gender: "female",
    aliases: [],
    ...overrides,
  };
}

async function outFileWith(actors: ActorEntity[]): Promise<string> {
  const file = path.join(await mkdtemp(path.join(tmpdir(), "build-actors-")), "actors.json");
  await writeFile(file, JSON.stringify(actors), "utf8");
  return file;
}

describe("kanaLosses", () => {
  it("今ある出力にあってこれから書く出力に無いかなの声優を返す", async () => {
    const file = await outFileWith([
      actor(),
      actor({ canonicalName: "ゆかな", nameKana: "ゆかな" }),
    ]);
    expect(
      await kanaLosses(file, [
        actor({ nameKana: undefined }),
        actor({ canonicalName: "ゆかな", nameKana: "ゆかな" }),
      ]),
    ).toEqual(["上田麗奈"]);
  });

  it("声優ごと出力から消えた場合は数えない (絞り込みは意図した結果)", async () => {
    const file = await outFileWith([actor()]);
    expect(await kanaLosses(file, [])).toEqual([]);
  });

  it("かなが増えるだけなら何も失わない", async () => {
    const file = await outFileWith([actor({ nameKana: undefined })]);
    expect(await kanaLosses(file, [actor()])).toEqual([]);
  });

  it("出力がまだ無ければ比べる相手が無い", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "build-actors-"));
    expect(await kanaLosses(path.join(directory, "none.json"), [actor()])).toEqual([]);
  });
});

describe("genderLosses", () => {
  it("今ある出力で付いていて、これから書く出力で「不明」に戻る声優を返す", async () => {
    const file = await outFileWith([actor(), actor({ canonicalName: "梶裕貴", gender: "male" })]);
    expect(
      await genderLosses(file, [
        actor({ gender: "unknown" }),
        actor({ canonicalName: "梶裕貴", gender: "male" }),
      ]),
    ).toEqual(["上田麗奈"]);
  });

  it("元から「不明」なら失うものが無い", async () => {
    const file = await outFileWith([actor({ gender: "unknown" })]);
    expect(await genderLosses(file, [actor({ gender: "unknown" })])).toEqual([]);
  });

  it("声優ごと出力から消えた場合は数えない (絞り込みは意図した結果)", async () => {
    const file = await outFileWith([actor()]);
    expect(await genderLosses(file, [])).toEqual([]);
  });

  it("出力がまだ無ければ比べる相手が無い", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "build-actors-"));
    expect(await genderLosses(path.join(directory, "none.json"), [actor()])).toEqual([]);
  });
});
