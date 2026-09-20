import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ActorEntity } from "./actor-entity.ts";
import { kanaLosses } from "./build-actors.ts";

function actor(overrides: Partial<ActorEntity> = {}): ActorEntity {
  return {
    id: "va_ueda-reina",
    slug: "ueda-reina",
    canonicalName: "上田麗奈",
    nameKana: "うえだれいな",
    anilistStaffId: 118602,
    status: "active",
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

  it("声優ごと消えた場合もかなを失う", async () => {
    const file = await outFileWith([actor()]);
    expect(await kanaLosses(file, [])).toEqual(["上田麗奈"]);
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
