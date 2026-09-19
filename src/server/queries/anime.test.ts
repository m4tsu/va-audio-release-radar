import { describe, expect, it } from "vitest";
import {
  type AnimeSeed,
  animeByActor,
  animeSitemapEntries,
  getAnimeBySlug,
  hasSeasonAnime,
  listSeasonAnime,
  upsertAnime,
} from "./anime";
import { ingest } from "./ingest";
import { HANAZAWA, NOW, payload, rawWork, setupDb, UEDA } from "./test-fixtures";

function anime(overrides: Partial<AnimeSeed> = {}): AnimeSeed {
  return {
    id: "anilist:195516",
    slug: "kusuriya-no-hitorigoto-3rd-season",
    titleNative: "薬屋のひとりごと 第3期",
    titleRomaji: "Kusuriya no Hitorigoto 3rd Season",
    titleEnglish: "The Apothecary Diaries Season 3",
    seasonYear: 2026,
    season: "FALL",
    coverImageUrl: "https://s4.anilist.co/cover.jpg",
    appearances: [
      {
        voiceActorId: UEDA.id,
        characterId: "anilist:12345",
        characterNameNative: "猫猫",
        characterNameFull: "Maomao",
        characterImageUrl: "https://s4.anilist.co/char.jpg",
        role: "main",
      },
    ],
    ...overrides,
  };
}

/** 声優に音声作品を 1 件持たせる。アニメの読み取りはこれが無いと何も返さない */
async function giveWork(
  db: Awaited<ReturnType<typeof setupDb>>,
  actorId: string,
  actorName: string,
  storeProductId: string,
  category = "SOU",
) {
  await ingest(
    db,
    payload({
      runId: `run-${storeProductId}`,
      voiceActorId: actorId,
      works: [rawWork({ storeProductId, creditedNames: [actorName], storeCategory: category })],
    }),
    NOW,
  );
}

describe("upsertAnime", () => {
  it("作品と出演を入れ、2 回流しても重複しない", async () => {
    const db = await setupDb();

    const first = await upsertAnime(db, [anime()], NOW);
    const second = await upsertAnime(db, [anime()], NOW);

    expect(first).toEqual({ titles: 1, appearances: 1, skippedAppearances: 0 });
    expect(second).toEqual({ titles: 1, appearances: 1, skippedAppearances: 0 });

    await giveWork(db, UEDA.id, UEDA.canonicalName, "RJ1");
    const detail = await getAnimeBySlug(db, anime().slug);
    expect(detail?.cast).toHaveLength(1);
  });

  it("DB に居ない声優の出演は取り込まずに数える", async () => {
    const db = await setupDb();

    const result = await upsertAnime(
      db,
      [
        anime({
          appearances: [
            { voiceActorId: "va_unknown", characterId: "anilist:1", role: "main" },
            {
              voiceActorId: UEDA.id,
              characterId: "anilist:2",
              characterNameNative: "猫猫",
              role: "main",
            },
          ],
        }),
      ],
      NOW,
    );

    expect(result).toEqual({ titles: 1, appearances: 1, skippedAppearances: 1 });
  });

  it("英語タイトルとカバー画像が無くても入る", async () => {
    const db = await setupDb();
    await upsertAnime(db, [anime({ titleEnglish: undefined, coverImageUrl: undefined })], NOW);
    await giveWork(db, UEDA.id, UEDA.canonicalName, "RJ1");

    const detail = await getAnimeBySlug(db, anime().slug);
    expect(detail?.titleEnglish).toBeUndefined();
    expect(detail?.coverImageUrl).toBeUndefined();
  });
});

describe("getAnimeBySlug", () => {
  it("音声作品を持つ出演者だけを返す", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    await upsertAnime(
      db,
      [
        anime({
          appearances: [
            {
              voiceActorId: UEDA.id,
              characterId: "anilist:1",
              characterNameNative: "猫猫",
              role: "main",
            },
            {
              voiceActorId: HANAZAWA.id,
              characterId: "anilist:2",
              characterNameNative: "別のキャラ",
              role: "main",
            },
          ],
        }),
      ],
      NOW,
    );
    // 上田だけに音声作品を持たせる
    await giveWork(db, UEDA.id, UEDA.canonicalName, "RJ1");

    const detail = await getAnimeBySlug(db, anime().slug);

    expect(detail?.cast.map((member) => member.actor.id)).toEqual([UEDA.id]);
  });

  it("出演者が全員音声作品を持たなければ undefined", async () => {
    const db = await setupDb();
    await upsertAnime(db, [anime()], NOW);

    expect(await getAnimeBySlug(db, anime().slug)).toBeUndefined();
  });

  it("主演を先に、同じ役の中は声優名順で並べる", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    await upsertAnime(
      db,
      [
        anime({
          appearances: [
            {
              voiceActorId: UEDA.id,
              characterId: "anilist:1",
              characterNameNative: "助演キャラ",
              role: "supporting",
            },
            {
              voiceActorId: HANAZAWA.id,
              characterId: "anilist:2",
              characterNameNative: "主演キャラ",
              role: "main",
            },
          ],
        }),
      ],
      NOW,
    );
    await giveWork(db, UEDA.id, UEDA.canonicalName, "RJ1");
    await giveWork(db, HANAZAWA.id, HANAZAWA.canonicalName, "RJ2");

    const detail = await getAnimeBySlug(db, anime().slug);

    expect(detail?.cast.map((member) => member.role)).toEqual(["main", "supporting"]);
  });

  it("媒体別の音声作品数を添える", async () => {
    const db = await setupDb();
    await upsertAnime(db, [anime()], NOW);
    await giveWork(db, UEDA.id, UEDA.canonicalName, "RJ1");
    await giveWork(db, UEDA.id, UEDA.canonicalName, "RJ2");

    const detail = await getAnimeBySlug(db, anime().slug);
    const counts = detail?.cast[0]?.workCounts ?? [];

    expect(counts.reduce((sum, item) => sum + item.count, 0)).toBe(2);
  });

  it("同じ声優が 2 キャラ演じていれば 2 行返る", async () => {
    const db = await setupDb();
    await upsertAnime(
      db,
      [
        anime({
          appearances: [
            {
              voiceActorId: UEDA.id,
              characterId: "anilist:1",
              characterNameNative: "猫猫",
              role: "main",
            },
            {
              voiceActorId: UEDA.id,
              characterId: "anilist:2",
              characterNameNative: "別のキャラ",
              role: "main",
            },
          ],
        }),
      ],
      NOW,
    );
    await giveWork(db, UEDA.id, UEDA.canonicalName, "RJ1");

    const detail = await getAnimeBySlug(db, anime().slug);

    expect(detail?.cast).toHaveLength(2);
    // 人数は重複を除いて数える
    expect(detail?.actorCount).toBe(1);
  });
});

describe("listSeasonAnime", () => {
  it("音声作品を持つ出演者が 0 人の作品は返さない", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    await upsertAnime(
      db,
      [
        anime(),
        anime({
          id: "anilist:2",
          slug: "another-show",
          titleRomaji: "Another Show",
          appearances: [
            {
              voiceActorId: HANAZAWA.id,
              characterId: "anilist:9",
              characterNameNative: "キャラ",
              role: "main",
            },
          ],
        }),
      ],
      NOW,
    );
    await giveWork(db, UEDA.id, UEDA.canonicalName, "RJ1");

    const list = await listSeasonAnime(db, 2026, "FALL");

    expect(list.map((item) => item.slug)).toEqual([anime().slug]);
    expect(list[0]?.actorCount).toBe(1);
  });

  it("別シーズンの作品は返さない", async () => {
    const db = await setupDb();
    await upsertAnime(db, [anime()], NOW);
    await giveWork(db, UEDA.id, UEDA.canonicalName, "RJ1");

    expect(await listSeasonAnime(db, 2026, "SUMMER")).toEqual([]);
    expect(await hasSeasonAnime(db, 2026, "FALL")).toBe(true);
    expect(await hasSeasonAnime(db, 2026, "SUMMER")).toBe(false);
  });
});

describe("animeByActor", () => {
  it("新しいシーズンから並べる", async () => {
    const db = await setupDb();
    await upsertAnime(
      db,
      [
        anime(),
        anime({
          id: "anilist:2",
          slug: "old-show",
          titleRomaji: "Old Show",
          titleNative: "古い作品",
          seasonYear: 2024,
          season: "WINTER",
        }),
      ],
      NOW,
    );

    const list = await animeByActor(db, UEDA.id);

    expect(list.map((item) => item.slug)).toEqual([anime().slug, "old-show"]);
  });

  it("音声作品の有無で絞らない (本人の識別に使うため)", async () => {
    const db = await setupDb();
    await upsertAnime(db, [anime()], NOW);

    expect(await animeByActor(db, UEDA.id)).toHaveLength(1);
  });
});

describe("animeSitemapEntries", () => {
  it("中身が出ない作品は載せない", async () => {
    const db = await setupDb();
    await upsertAnime(db, [anime()], NOW);

    expect(await animeSitemapEntries(db)).toEqual([]);

    await giveWork(db, UEDA.id, UEDA.canonicalName, "RJ1");
    expect((await animeSitemapEntries(db)).map((item) => item.slug)).toEqual([anime().slug]);
  });
});
