import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES_DIR } from "../lib/paths.ts";
import { parseMediaCharacters, parseSeasonPage } from "./anilist.ts";
import { buildAniListPayload } from "./anilist-payload.ts";

/**
 * 1 作品あたりの出演者を 25 人で切らないこと。
 *
 * 切ると、同じ役の中の順序が取得ごとに変わるせいで誰が対象声優になるかが走行のたびに
 * 入れ替わる (`docs/research/anilist-cast-instability-2026-09-22.md`)。
 * fixture は実際の応答を切り詰めたもの
 */

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(FIXTURES_DIR, name), "utf8"));
}

describe("parseSeasonPage の続きの検出", () => {
  it("1 ページに収まった作品は続きを要求しない", async () => {
    const parsed = parseSeasonPage(await fixture("anilist-season-page.json"));

    expect(parsed.moreCharacterMediaIds).toEqual([]);
  });

  it("続きがある作品の id を返す", () => {
    const parsed = parseSeasonPage({
      data: {
        Page: {
          pageInfo: { hasNextPage: false },
          media: [
            {
              id: 171018,
              title: { native: "ダンダダン", romaji: "Dandadan" },
              characters: {
                pageInfo: { hasNextPage: true },
                edges: [
                  {
                    role: "MAIN",
                    node: { id: 1, name: { native: "綾瀬桃" } },
                    voiceActors: [{ id: 10, name: { native: "若山詩音" } }],
                  },
                ],
              },
            },
          ],
        },
      },
    });

    expect(parsed.moreCharacterMediaIds).toEqual([171018]);
  });
});

describe("parseMediaCharacters", () => {
  it("2 ページ目の出演者を読み、まだ続きがあることを返す", async () => {
    const parsed = parseMediaCharacters(await fixture("anilist-media-characters-page2.json"));

    expect(parsed.hasNextPage).toBe(true);
    expect(parsed.credits.map((credit) => credit.nativeName)).toEqual([
      "万沙子磯辺",
      "越後屋コースケ",
    ]);
    expect(parsed.credits.every((credit) => credit.mediaId === 171018)).toBe(true);
  });

  it("最後のページでは続きがないことを返す", async () => {
    const parsed = parseMediaCharacters(await fixture("anilist-media-characters-page4.json"));

    expect(parsed.hasNextPage).toBe(false);
    expect(parsed.credits.map((credit) => credit.nativeName)).toEqual(["観世智顕"]);
  });

  it("作品が無い応答からは何も取らない", () => {
    expect(parseMediaCharacters({ data: { Media: null } })).toEqual({
      credits: [],
      hasNextPage: false,
    });
  });
});

describe("全ページを合わせて送る", () => {
  it("1 ページ目に居ない出演者も送る内容に入る", async () => {
    const season = { year: 2024, season: "FALL" as const };
    const first = parseSeasonPage({
      data: {
        Page: {
          pageInfo: { hasNextPage: false },
          media: [
            {
              id: 171018,
              title: { native: "ダンダダン", romaji: "Dandadan" },
              characters: {
                pageInfo: { hasNextPage: true },
                edges: [
                  {
                    role: "MAIN",
                    node: { id: 1, name: { native: "綾瀬桃" } },
                    voiceActors: [{ id: 10, name: { native: "若山詩音", full: "Shion Wakayama" } }],
                  },
                ],
              },
            },
          ],
        },
      },
    });
    const second = parseMediaCharacters(await fixture("anilist-media-characters-page2.json"));
    const last = parseMediaCharacters(await fixture("anilist-media-characters-page4.json"));

    const built = buildAniListPayload({
      runId: "test",
      startedAt: "2026-09-22T00:00:00.000Z",
      seasons: [season],
      media: first.media.map((item) => ({ ...item, season })),
      credits: [...first.credits, ...second.credits, ...last.credits].map((credit) => ({
        ...credit,
        season,
      })),
    });

    // 1 ページ目の 1 人だけでなく、2 ページ目と最後のページの人も送られる
    expect(built.payload.actors.map((actor) => actor.nativeName)).toEqual([
      "若山詩音",
      "万沙子磯辺",
      "越後屋コースケ",
      "観世智顕",
    ]);
  });
});
