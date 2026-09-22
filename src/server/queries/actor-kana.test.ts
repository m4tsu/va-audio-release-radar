import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { voiceActorAttributes, voiceActors } from "../db/schema";
import type { AppDb } from "../db/types";
import { listActorsNeedingKana, writeActorKana } from "./actor-attributes";
import { getActorBySlug } from "./actors";
import { HANAZAWA, NOW, setupDb, UEDA } from "./test-fixtures";

/**
 * かなを引く相手の選び方と、取得結果の入れ方。
 *
 * 要は「引いた人を二度引かない」こと。引けなかった人まで印を付けないと、記事が無い声優を
 * 毎週引き直すことになる
 */

const LATER = "2026-09-29T00:00:00.000Z";

/** かなを持たない声優 2 人。既定の UEDA はシードでかなが入るので使わない */
async function dbWithoutKana(): Promise<AppDb> {
  const db = await setupDb([{ ...UEDA, nameKana: undefined }, HANAZAWA]);
  return db;
}

describe("listActorsNeedingKana", () => {
  it("まだ引いていない声優を返す", async () => {
    const db = await dbWithoutKana();

    const targets = await listActorsNeedingKana(db, 10);

    expect(targets.map((target) => target.canonicalName).sort()).toEqual(
      ["上田麗奈", "花澤香菜"].sort(),
    );
  });

  it("引いた人は返らない (かなが取れなかった人も含む)", async () => {
    const db = await dbWithoutKana();
    await writeActorKana(db, [{ voiceActorId: UEDA.id }], NOW);

    const targets = await listActorsNeedingKana(db, 10);

    expect(targets.map((target) => target.id)).toEqual([HANAZAWA.id]);
  });

  it("上限の人数までしか返さない", async () => {
    const db = await dbWithoutKana();

    expect(await listActorsNeedingKana(db, 1)).toHaveLength(1);
  });
});

describe("writeActorKana", () => {
  it("かなが取れた人は付加情報の行が入り、印も付く", async () => {
    const db = await dbWithoutKana();

    const result = await writeActorKana(
      db,
      [{ voiceActorId: UEDA.id, kana: "うえだれいな", source: "wikipedia" }],
      NOW,
    );

    expect(result).toEqual({ written: 1, withoutKana: 0, skipped: 0 });
    expect((await getActorBySlug(db, UEDA.slug))?.nameKana).toBe("うえだれいな");
    const [row] = await db
      .select({ checkedAt: voiceActors.nameKanaCheckedAt })
      .from(voiceActors)
      .where(eq(voiceActors.id, UEDA.id));
    expect(row?.checkedAt).toBe(NOW);
  });

  it("かなが取れなかった人には印だけが付く", async () => {
    const db = await dbWithoutKana();

    const result = await writeActorKana(db, [{ voiceActorId: UEDA.id }], NOW);

    expect(result).toEqual({ written: 0, withoutKana: 1, skipped: 0 });
    expect(await db.select().from(voiceActorAttributes)).toEqual([]);
    const [row] = await db
      .select({ checkedAt: voiceActors.nameKanaCheckedAt })
      .from(voiceActors)
      .where(eq(voiceActors.id, UEDA.id));
    expect(row?.checkedAt).toBe(NOW);
  });

  it("Wikidata から取ったかなは出どころが分かれる", async () => {
    const db = await dbWithoutKana();

    await writeActorKana(
      db,
      [{ voiceActorId: UEDA.id, kana: "うえだれいな", source: "wikidata" }],
      NOW,
    );

    const rows = await db.select().from(voiceActorAttributes);
    expect(rows.map((row) => row.source)).toEqual(["wikidata"]);
  });

  it("台帳に居ない声優は数えるだけで何も書かない", async () => {
    const db = await dbWithoutKana();

    const result = await writeActorKana(
      db,
      [{ voiceActorId: "va_nobody", kana: "だれか", source: "wikipedia" }],
      NOW,
    );

    expect(result).toEqual({ written: 0, withoutKana: 0, skipped: 1 });
    expect(await db.select().from(voiceActorAttributes)).toEqual([]);
  });

  it("引き直すと、取れたかなと印が新しい値に変わる", async () => {
    const db = await dbWithoutKana();
    await writeActorKana(db, [{ voiceActorId: UEDA.id }], NOW);

    await writeActorKana(
      db,
      [{ voiceActorId: UEDA.id, kana: "うえだれいな", source: "wikipedia" }],
      LATER,
    );

    expect((await getActorBySlug(db, UEDA.slug))?.nameKana).toBe("うえだれいな");
    const [row] = await db
      .select({ checkedAt: voiceActors.nameKanaCheckedAt })
      .from(voiceActors)
      .where(eq(voiceActors.id, UEDA.id));
    expect(row?.checkedAt).toBe(LATER);
  });
});
