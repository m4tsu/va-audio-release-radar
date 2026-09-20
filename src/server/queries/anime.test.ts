import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { animeTitleSynonyms, animeTitles } from "../db/schema";
import {
  type AnimeSeed,
  animeByActor,
  animeForActors,
  animeSitemapEntries,
  getAnimeBySlug,
  hasSeasonAnime,
  listSeasonAnime,
  listSeasonsWithAnime,
  searchAnime,
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

    expect(first).toEqual({ titles: 1, appearances: 1, skippedAppearances: 0, synonyms: 0 });
    expect(second).toEqual({ titles: 1, appearances: 1, skippedAppearances: 0, synonyms: 0 });

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

    expect(result).toEqual({ titles: 1, appearances: 1, skippedAppearances: 1, synonyms: 0 });
  });

  it("英語タイトルとカバー画像が無くても入る", async () => {
    const db = await setupDb();
    await upsertAnime(db, [anime({ titleEnglish: undefined, coverImageUrl: undefined })], NOW);
    await giveWork(db, UEDA.id, UEDA.canonicalName, "RJ1");

    const detail = await getAnimeBySlug(db, anime().slug);
    expect(detail?.titleEnglish).toBeUndefined();
    expect(detail?.coverImageUrl).toBeUndefined();
  });

  it("人気度・形式・放送日・代表色を入れ、取り込み直すと新しい値になる", async () => {
    const db = await setupDb();

    await upsertAnime(
      db,
      [
        anime({
          popularity: 70218,
          format: "TV",
          startDate: "2026-10-02",
          endDate: "2026-12-25",
          coverImageColor: "#e4a128",
        }),
      ],
      NOW,
    );
    await upsertAnime(db, [anime({ popularity: 80000, format: "ONA" })], NOW);

    const [row] = await db.select().from(animeTitles).where(eq(animeTitles.id, anime().id));
    expect(row?.popularity).toBe(80000);
    expect(row?.format).toBe("ONA");
    // 2 回目に無かった項目は空になる。AniList が返さなくなった値を残さない
    expect(row?.startDate).toBeNull();
    expect(row?.endDate).toBeNull();
    expect(row?.coverImageColor).toBeNull();
  });

  it("別名タイトルを入れ替え、消えた名前は残らない", async () => {
    const db = await setupDb();

    const first = await upsertAnime(db, [anime({ synonyms: ["ロシデレ", "Roshidere"] })], NOW);
    expect(first.synonyms).toBe(2);

    const second = await upsertAnime(db, [anime({ synonyms: ["ロシデレ"] })], NOW);
    expect(second.synonyms).toBe(1);

    const rows = await db
      .select({ name: animeTitleSynonyms.name })
      .from(animeTitleSynonyms)
      .where(eq(animeTitleSynonyms.animeTitleId, anime().id));
    expect(rows.map((row) => row.name)).toEqual(["ロシデレ"]);
  });

  it("同じ別名が 2 度入っていても落ちない", async () => {
    const db = await setupDb();

    const result = await upsertAnime(db, [anime({ synonyms: ["ロシデレ", "ロシデレ"] })], NOW);

    expect(result.synonyms).toBe(1);
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

  /** 画面が「フォロー中の声優が出ているか」を自分で判定するための材料 */
  it("音声作品を持つ出演者の ID を添える", async () => {
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
              role: "supporting",
            },
          ],
        }),
      ],
      NOW,
    );
    await giveWork(db, UEDA.id, UEDA.canonicalName, "RJ1");

    const [item] = await listSeasonAnime(db, 2026, "FALL");

    // 音声作品を持たない花澤は数にも ID にも入らない
    expect(item?.actorIds).toEqual([UEDA.id]);
    expect(item?.actorCount).toBe(1);
  });

  it("人気の高い順に返し、人気度が無い作品は末尾に置く", async () => {
    const db = await setupDb();
    await upsertAnime(
      db,
      [
        anime({ id: "anilist:1", slug: "middle", titleRomaji: "Middle", popularity: 100 }),
        anime({ id: "anilist:2", slug: "unknown", titleRomaji: "Unknown" }),
        anime({ id: "anilist:3", slug: "top", titleRomaji: "Top", popularity: 500 }),
      ],
      NOW,
    );
    await giveWork(db, UEDA.id, UEDA.canonicalName, "RJ1");

    const list = await listSeasonAnime(db, 2026, "FALL");

    // 人気度を持たない作品 (取り込み前からある行) は末尾
    expect(list.map((item) => item.slug)).toEqual(["top", "middle", "unknown"]);
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

describe("searchAnime", () => {
  /** 日本語名・ローマ字名・英語名・別名のどれでも当たる */
  it("タイトルと別名の部分一致で引ける", async () => {
    const db = await setupDb();
    await upsertAnime(db, [anime({ synonyms: ["ロシデレ"] })], NOW);
    await giveWork(db, UEDA.id, UEDA.canonicalName, "RJ1");

    for (const query of ["ひとりごと", "Kusuriya", "Apothecary", "ロシデレ"]) {
      const found = await searchAnime(db, query);
      expect(found.map((item) => item.slug)).toEqual([anime().slug]);
    }
  });

  it("一致しない語では何も返さない", async () => {
    const db = await setupDb();
    await upsertAnime(db, [anime()], NOW);
    await giveWork(db, UEDA.id, UEDA.canonicalName, "RJ1");

    expect(await searchAnime(db, "存在しない作品")).toEqual([]);
  });

  it("空の検索語とワイルドカードだけの検索語では全件を返さない", async () => {
    const db = await setupDb();
    await upsertAnime(db, [anime()], NOW);
    await giveWork(db, UEDA.id, UEDA.canonicalName, "RJ1");

    expect(await searchAnime(db, "   ")).toEqual([]);
    expect(await searchAnime(db, "%")).toEqual([]);
  });

  it("音声作品を持つ出演者が 0 人の作品は返さない", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    await upsertAnime(
      db,
      [
        anime({
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

    expect(await searchAnime(db, "ひとりごと")).toEqual([]);
  });

  it("人気の高い順に返し、件数を絞れる", async () => {
    const db = await setupDb();
    await upsertAnime(
      db,
      [
        anime({ id: "anilist:1", slug: "show-a", titleRomaji: "Show A", popularity: 100 }),
        anime({ id: "anilist:2", slug: "show-b", titleRomaji: "Show B", popularity: 500 }),
      ],
      NOW,
    );
    await giveWork(db, UEDA.id, UEDA.canonicalName, "RJ1");

    expect((await searchAnime(db, "Show")).map((item) => item.slug)).toEqual(["show-b", "show-a"]);
    expect((await searchAnime(db, "Show", 1)).map((item) => item.slug)).toEqual(["show-b"]);
  });

  /** 同じ語が複数の別名に当たっても、作品は 1 度だけ出す */
  it("別名が複数当たっても作品は重複しない", async () => {
    const db = await setupDb();
    await upsertAnime(db, [anime({ synonyms: ["ロシデレ 1", "ロシデレ 2"] })], NOW);
    await giveWork(db, UEDA.id, UEDA.canonicalName, "RJ1");

    expect(await searchAnime(db, "ロシデレ")).toHaveLength(1);
  });
});

describe("listSeasonsWithAnime", () => {
  it("出せる作品があるシーズンを新しい順に、作品数つきで返す", async () => {
    const db = await setupDb();
    await upsertAnime(
      db,
      [
        anime(),
        anime({
          id: "anilist:2",
          slug: "old-show",
          titleRomaji: "Old Show",
          seasonYear: 2024,
          season: "WINTER",
        }),
      ],
      NOW,
    );
    await giveWork(db, UEDA.id, UEDA.canonicalName, "RJ1");

    expect(await listSeasonsWithAnime(db)).toEqual([
      { seasonYear: 2026, season: "FALL", animeCount: 1 },
      { seasonYear: 2024, season: "WINTER", animeCount: 1 },
    ]);
  });

  it("出せる作品が無いシーズンは返さない", async () => {
    const db = await setupDb();
    await upsertAnime(db, [anime()], NOW);

    // 出演者が音声作品を持たないので、シーズンごと出ない
    expect(await listSeasonsWithAnime(db)).toEqual([]);
  });
});

describe("animeForActors", () => {
  it("渡した声優が出ている作品を新しいシーズンから返す", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    await upsertAnime(
      db,
      [
        anime(),
        anime({
          id: "anilist:2",
          slug: "old-show",
          titleRomaji: "Old Show",
          seasonYear: 2024,
          season: "WINTER",
        }),
        anime({
          id: "anilist:3",
          slug: "other-cast-show",
          titleRomaji: "Other Cast Show",
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
    await giveWork(db, HANAZAWA.id, HANAZAWA.canonicalName, "RJ2");

    const list = await animeForActors(db, [UEDA.id]);

    expect(list.map((item) => item.slug)).toEqual([anime().slug, "old-show"]);
  });

  it("フォローが 0 件なら引かない", async () => {
    const db = await setupDb();

    expect(await animeForActors(db, [])).toEqual([]);
  });

  it("人数は音声作品を持つ出演者で数える (フォロー中の人数ではない)", async () => {
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
    await giveWork(db, UEDA.id, UEDA.canonicalName, "RJ1");
    await giveWork(db, HANAZAWA.id, HANAZAWA.canonicalName, "RJ2");

    const [item] = await animeForActors(db, [UEDA.id]);

    expect(item?.actorCount).toBe(2);
  });

  it("limit で切る", async () => {
    const db = await setupDb();
    await upsertAnime(
      db,
      [
        anime(),
        anime({
          id: "anilist:2",
          slug: "old-show",
          titleRomaji: "Old Show",
          seasonYear: 2024,
          season: "WINTER",
        }),
      ],
      NOW,
    );
    await giveWork(db, UEDA.id, UEDA.canonicalName, "RJ1");

    expect(await animeForActors(db, [UEDA.id], 1)).toHaveLength(1);
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

  it("英語名が無い作品でもローマ字名を返す", async () => {
    const db = await setupDb();
    await upsertAnime(db, [anime({ titleEnglish: undefined })], NOW);

    const [item] = await animeByActor(db, UEDA.id);

    // 英語名が無い作品は画面がローマ字名で代えるので、英語名だけでは足りない
    expect(item?.titleEnglish).toBeUndefined();
    expect(item?.titleRomaji).toBe("Kusuriya no Hitorigoto 3rd Season");
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
