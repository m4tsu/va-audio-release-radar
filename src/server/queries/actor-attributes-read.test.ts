import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { AttributeSource } from "@/domain/types";
import { voiceActorAttributes, voiceActors } from "../db/schema";
import type { AppDb } from "../db/types";
import { writeActorAttributes } from "./actor-attributes";
import { actorSeedSchema, getActorBySlug, listActors, searchActors } from "./actors";
import { giveEachActorAWork, NOW, setupDb, UEDA } from "./test-fixtures";

/**
 * 表に出るかなとローマ字を、出どころの優先順位で選ぶところ。
 *
 * 順位が崩れると、人が書いた訂正が取得した値に負けて、画面の名前が勝手に戻る。
 * 読み取りの入口 (一覧・詳細・検索) それぞれから同じ値が出ることまで見る
 */

async function writeKana(db: AppDb, source: AttributeSource, value: string) {
  await writeActorAttributes(
    db,
    [{ voiceActorId: UEDA.id, attribute: "nameKana", source, value }],
    NOW,
  );
}

async function dbWithUeda(): Promise<AppDb> {
  const db = await setupDb();
  // 一覧と検索は「ページが出る声優」だけを返すので、作品を 1 件持たせる
  await giveEachActorAWork(db, [UEDA]);
  // シードが入れる Wikipedia のかなを消して、各テストが出どころを自分で決められるようにする
  await db.delete(voiceActorAttributes);
  return db;
}

describe("かなの優先順位", () => {
  it("手で書いたものが Wikidata と Wikipedia より先に選ばれる", async () => {
    const db = await dbWithUeda();
    await writeKana(db, "wikipedia", "うえだれいな (記事)");
    await writeKana(db, "wikidata", "うえだれいな (項目)");
    await writeKana(db, "editorial", "うえだれいな (手書き)");

    expect((await getActorBySlug(db, UEDA.slug))?.nameKana).toBe("うえだれいな (手書き)");
  });

  it("手で書いたものが無ければ Wikidata が Wikipedia より先", async () => {
    const db = await dbWithUeda();
    await writeKana(db, "wikipedia", "うえだれいな (記事)");
    await writeKana(db, "wikidata", "うえだれいな (項目)");

    expect((await getActorBySlug(db, UEDA.slug))?.nameKana).toBe("うえだれいな (項目)");
  });

  it("付加情報の行が無ければ、かなは出ない (他に置き場が無い)", async () => {
    const db = await dbWithUeda();

    expect((await getActorBySlug(db, UEDA.slug))?.nameKana).toBeUndefined();
  });

  it("順位に並べていない出どころの行は選ばない", async () => {
    const db = await dbWithUeda();
    // 表示用ローマ字の順位は 編集 だけ。かなの出どころで書いても、ローマ字としては出さない
    await writeActorAttributes(
      db,
      [
        {
          voiceActorId: UEDA.id,
          attribute: "nameEn",
          source: "wikipedia",
          value: "Wrong Romaji",
        },
      ],
      NOW,
    );

    expect((await getActorBySlug(db, UEDA.slug))?.nameEn).toBeUndefined();
  });

  it("一覧にも同じ値が出る", async () => {
    const db = await dbWithUeda();
    await writeKana(db, "wikipedia", "うえだれいな");

    const listed = (await listActors(db)).find((actor) => actor.id === UEDA.id);
    expect(listed?.nameKana).toBe("うえだれいな");
  });

  it("かなで検索できる", async () => {
    const db = await dbWithUeda();
    await writeKana(db, "wikipedia", "うえだれいな");

    expect((await searchActors(db, "えだれい")).map((actor) => actor.id)).toEqual([UEDA.id]);
  });

  it("付加情報を書き換えると検索に出る値も変わる", async () => {
    const db = await dbWithUeda();
    await writeKana(db, "wikipedia", "まちがったよみ");

    await writeKana(db, "editorial", "うえだれいな");

    expect(await searchActors(db, "まちがったよみ")).toEqual([]);
    expect((await searchActors(db, "うえだれいな")).map((actor) => actor.id)).toEqual([UEDA.id]);
  });
});

describe("シードが受け取らない欄", () => {
  it("かなと表示用ローマ字を載せたシードは断る (黙って落とすと、送ったのに入らない値ができる)", () => {
    const seed = {
      id: "va_sato-rina",
      slug: "sato-rina",
      canonicalName: "佐藤利奈",
      anilistStaffId: 100010,
    };

    expect(actorSeedSchema.safeParse({ ...seed, nameKana: "さとうりな" }).success).toBe(false);
    expect(actorSeedSchema.safeParse({ ...seed, nameEn: "Rina Satou" }).success).toBe(false);
    expect(actorSeedSchema.safeParse(seed).success).toBe(true);
  });
});

describe("表示用ローマ字の優先順位", () => {
  it("手で書いたものが供給元の写しより先に選ばれる", async () => {
    const db = await dbWithUeda();
    await db.update(voiceActors).set({ nameEn: "Reina Ueda" }).where(eq(voiceActors.id, UEDA.id));
    await writeActorAttributes(
      db,
      [{ voiceActorId: UEDA.id, attribute: "nameEn", source: "editorial", value: "Reina Ueda!" }],
      NOW,
    );

    expect((await getActorBySlug(db, UEDA.slug))?.nameEn).toBe("Reina Ueda!");
  });

  it("手で書いたものが無ければ供給元の写しの列を使う", async () => {
    const db = await dbWithUeda();
    await db.update(voiceActors).set({ nameEn: "Reina Ueda" }).where(eq(voiceActors.id, UEDA.id));

    expect((await getActorBySlug(db, UEDA.slug))?.nameEn).toBe("Reina Ueda");
    const listed = (await listActors(db)).find((actor) => actor.id === UEDA.id);
    expect(listed?.nameEn).toBe("Reina Ueda");
  });

  it("どちらも無ければローマ字なし", async () => {
    const db = await dbWithUeda();

    expect((await getActorBySlug(db, UEDA.slug))?.nameEn).toBeUndefined();
  });
});
