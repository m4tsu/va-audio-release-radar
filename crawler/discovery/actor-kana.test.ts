import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ActorKanaRecord,
  kanaByCanonicalName,
  readKanaCache,
  toStoredKana,
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

describe("toStoredKana", () => {
  it("姓名の間の空白を落とす", () => {
    expect(toStoredKana("うえだ れいな")).toBe("うえだれいな");
  });

  it("中黒で区切られた読みも受け取る", () => {
    expect(toStoredKana("ブリドカット・セーラ・めぐみ")).toBe("ぶりどかっとせーらめぐみ");
  });

  it("カタカナはひらがなに寄せる (ひらがなで引いた検索に当てるため)", () => {
    expect(toStoredKana("みどう ダリア")).toBe("みどうだりあ");
    expect(toStoredKana("ソンド")).toBe("そんど");
  });

  it("長音符は残す", () => {
    expect(toStoredKana("ひろせ ゆうすけー")).toBe("ひろせゆうすけー");
  });

  it("内部リンクと脚注は落とす", () => {
    expect(toStoredKana("[[のがみ ゆかな|ゆかな]]")).toBe("ゆかな");
    expect(
      toStoredKana('あまの さとみ<ref name="x">{{Cite web|url=http://example.com}}</ref>'),
    ).toBe("あまのさとみ");
  });

  it("かな以外が残る値は読みとして扱わない", () => {
    expect(toStoredKana("上田 麗奈")).toBeUndefined();
    expect(toStoredKana("KENN")).toBeUndefined();
    expect(toStoredKana("")).toBeUndefined();
  });
});

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
