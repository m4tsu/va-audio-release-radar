import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ActorKanaRecord,
  kanaByCanonicalName,
  pendingNames,
  readKanaCache,
} from "./actor-kana.ts";

function record(overrides: Partial<ActorKanaRecord> = {}): ActorKanaRecord {
  return {
    canonicalName: "上田麗奈",
    status: "ok",
    kana: "うえだれいな",
    source: "furigana",
    fetchedAt: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("kanaByCanonicalName", () => {
  it("かなが取れた人だけを返す", () => {
    expect(
      kanaByCanonicalName([
        record(),
        record({ canonicalName: "ゆかな", kana: "ゆかな", source: "kana-name" }),
        record({ canonicalName: "満島ひかり", status: "rejected", kana: undefined }),
        record({ canonicalName: "居ない人", status: "not-found", kana: undefined }),
        record({ canonicalName: "失敗した人", status: "failed", kana: undefined }),
      ]),
    ).toEqual({ 上田麗奈: "うえだれいな", ゆかな: "ゆかな" });
  });

  it("status が ok でもかなが無ければ入れない", () => {
    expect(kanaByCanonicalName([record({ kana: undefined })])).toEqual({});
  });
});

describe("readKanaCache", () => {
  it("ファイルがまだ無ければ undefined", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "actor-kana-"));
    await expect(readKanaCache(path.join(directory, "none.json"))).resolves.toBeUndefined();
  });

  it("壊れた JSON は投げる (黙って最初から引き直さない)", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "actor-kana-"));
    const file = path.join(directory, "broken.json");
    await writeFile(file, '{"records": [', "utf8");
    await expect(readKanaCache(file)).rejects.toThrow(/JSON として読めない/);
  });

  it("records を持たない JSON も投げる", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "actor-kana-"));
    const file = path.join(directory, "shape.json");
    await writeFile(file, '{"startedAt": "2026-09-20T00:00:00.000Z"}', "utf8");
    await expect(readKanaCache(file)).rejects.toThrow(/records 配列が無い/);
  });

  it("読めた結果はそのまま返す", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "actor-kana-"));
    const file = path.join(directory, "cache.json");
    await writeFile(file, JSON.stringify({ records: [record()] }), "utf8");
    const cache = await readKanaCache(file);
    expect(cache?.records).toHaveLength(1);
  });
});

describe("pendingNames", () => {
  const names = ["上田麗奈", "ゆかな", "満島ひかり", "杉田智和"];

  it("取得済みの人を飛ばす (取れなかった人も引き直さない)", () => {
    const done = [
      record(),
      record({ canonicalName: "満島ひかり", status: "rejected", kana: undefined }),
    ];
    expect(pendingNames(names, done)).toEqual(["ゆかな", "杉田智和"]);
  });

  it("limit で人数を区切る", () => {
    expect(pendingNames(names, [], 2)).toEqual(["上田麗奈", "ゆかな"]);
  });

  it("続きから区切ると、飛ばした後の先頭から数える", () => {
    expect(pendingNames(names, [record()], 2)).toEqual(["ゆかな", "満島ひかり"]);
  });

  it("全員取得済みなら空", () => {
    expect(
      pendingNames(
        names,
        names.map((name) => record({ canonicalName: name })),
      ),
    ).toEqual([]);
  });
});
