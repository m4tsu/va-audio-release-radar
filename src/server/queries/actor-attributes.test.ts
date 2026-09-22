import { describe, expect, it } from "vitest";
import { voiceActorAttributes } from "../db/schema";
import { writeActorAttributes } from "./actor-attributes";
import { NOW, setupDb, UEDA } from "./test-fixtures";

/**
 * 付加情報の書き込み。出どころごとに行が分かれることと、
 * 書き手が自分の出どころの行しか触らないことを見る
 */

const LATER = "2026-09-29T00:00:00.000Z";

describe("writeActorAttributes", () => {
  it("同じ声優の同じ属性でも、出どころが違えば別の行になる", async () => {
    const db = await setupDb();

    await writeActorAttributes(
      db,
      [
        {
          voiceActorId: UEDA.id,
          attribute: "nameKana",
          source: "wikipedia",
          value: "うえだれいな",
        },
        {
          voiceActorId: UEDA.id,
          attribute: "nameKana",
          source: "editorial",
          value: "うえだ れいな",
        },
      ],
      NOW,
    );

    expect(await db.select().from(voiceActorAttributes)).toHaveLength(2);
  });

  it("書いた出どころの行だけが変わり、他の出どころの行は変わらない", async () => {
    const db = await setupDb();
    await writeActorAttributes(
      db,
      [
        {
          voiceActorId: UEDA.id,
          attribute: "nameKana",
          source: "editorial",
          value: "うえだ れいな",
        },
        {
          voiceActorId: UEDA.id,
          attribute: "nameKana",
          source: "wikipedia",
          value: "うえだれいな",
        },
      ],
      NOW,
    );

    await writeActorAttributes(
      db,
      [
        {
          voiceActorId: UEDA.id,
          attribute: "nameKana",
          source: "wikipedia",
          value: "うえだ れいな (取り直し)",
        },
      ],
      LATER,
    );

    const rows = await db
      .select({
        source: voiceActorAttributes.source,
        value: voiceActorAttributes.value,
        recordedAt: voiceActorAttributes.recordedAt,
      })
      .from(voiceActorAttributes)
      .orderBy(voiceActorAttributes.source);
    expect(rows).toEqual([
      { source: "editorial", value: "うえだ れいな", recordedAt: NOW },
      { source: "wikipedia", value: "うえだ れいな (取り直し)", recordedAt: LATER },
    ]);
  });

  it("居ない声優を指す行は書かずに数える (残りは書く)", async () => {
    const db = await setupDb();

    const result = await writeActorAttributes(
      db,
      [
        { voiceActorId: "va_nobody", attribute: "nameKana", source: "wikipedia", value: "だれか" },
        {
          voiceActorId: UEDA.id,
          attribute: "nameEn",
          source: "editorial",
          value: "Reina Ueda",
        },
      ],
      NOW,
    );

    expect(result).toEqual({ written: 1, skipped: 1 });
    expect(await db.select().from(voiceActorAttributes)).toHaveLength(1);
  });
});
