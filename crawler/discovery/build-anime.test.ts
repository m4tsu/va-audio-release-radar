import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AnimeEntity } from "./anime-entity.ts";
import { countByField, loadMedia } from "./build-anime.ts";

function anime(overrides: Partial<AnimeEntity> = {}): AnimeEntity {
  return {
    id: "anilist:195516",
    slug: "kusuriya-no-hitorigoto-3rd-season",
    titleRomaji: "Kusuriya no Hitorigoto 3rd Season",
    seasonYear: 2026,
    season: "FALL",
    appearances: [],
    ...overrides,
  };
}

/** `loadMedia` はファイルを読むので、中間結果と同じ形を書いた一時ファイルを渡す */
async function writeStaffJson(media: unknown): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "build-anime-"));
  const file = path.join(dir, "anilist-staff.json");
  await writeFile(file, JSON.stringify({ media }), "utf8");
  return file;
}

describe("loadMedia", () => {
  it("人気度が 1 件も無ければ、取り直しを促して失敗する", async () => {
    const file = await writeStaffJson([{ id: 1, titleRomaji: "Old Response" }]);

    await expect(loadMedia(file)).rejects.toThrow(/popularity/);
  });

  it("1 件でも人気度があれば読める", async () => {
    const file = await writeStaffJson([
      { id: 1, titleRomaji: "With Popularity", popularity: 100 },
      { id: 2, titleRomaji: "Without" },
    ]);

    await expect(loadMedia(file)).resolves.toHaveLength(2);
  });
});

describe("countByField", () => {
  it("項目ごとに値が入った作品数を数える", () => {
    const counts = new Map(
      countByField([
        anime({ popularity: 100, format: "TV", startDate: "2026-10-02", synonyms: ["略称"] }),
        anime({ popularity: 200, endDate: "2026-12-25", coverImageColor: "#e4a128" }),
      ]),
    );

    expect(counts.get("人気度あり")).toBe(2);
    expect(counts.get("形式あり")).toBe(1);
    expect(counts.get("放送開始日あり")).toBe(1);
    expect(counts.get("放送終了日あり")).toBe(1);
    expect(counts.get("別名タイトルあり")).toBe(1);
    expect(counts.get("表紙の代表色あり")).toBe(1);
  });

  it("0 件でも項目が消えない (取り直し忘れに気づけるように)", () => {
    const counts = new Map(countByField([anime()]));

    expect(counts.get("人気度あり")).toBe(0);
  });
});
