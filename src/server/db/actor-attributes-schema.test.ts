import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { upsertActors } from "../queries/actors";
import { NOW, setupDb, UEDA } from "../queries/test-fixtures";
import { voiceActorAttributes, voiceActors } from "./schema";
import { applyMigrationsAfter, createMigratedTestDb } from "./test-db";
import type { AppDb } from "./types";

/**
 * 声優の付加情報の表と、同一性の列がマイグレーション SQL の制約どおりに振る舞うことを確かめる。
 *
 * 表を読み書きする関数はまだ無い (管理 API と読み取り側は別 issue) ので、drizzle で直接行を入れて
 * 制約を見る。制約は `migrations/*.sql` に書かれたものが本番に当たるので、適用後の DB で確かめる
 */

/** 付加情報の表が入る直前のマイグレーション。既存の行がどう写されるかを見るための起点 */
const BEFORE_ATTRIBUTES = "0013_overjoyed_magik";

async function writeAttribute(
  db: AppDb,
  value: string,
  source: "editorial" | "wikipedia" = "wikipedia",
  recordedAt = NOW,
) {
  await db
    .insert(voiceActorAttributes)
    .values({
      voiceActorId: UEDA.id,
      attribute: "nameKana",
      source,
      value,
      recordedAt,
    })
    .onConflictDoUpdate({
      target: [
        voiceActorAttributes.voiceActorId,
        voiceActorAttributes.attribute,
        voiceActorAttributes.source,
      ],
      set: { value, recordedAt },
    });
}

describe("voice_actor_attributes", () => {
  it("同じ 声優 × 属性 × 出どころ をもう一度書くと値と記録日時が更新され、行は増えない", async () => {
    const db = await setupDb();
    await writeAttribute(db, "うえだれいな");

    await writeAttribute(db, "うえだ れいな", "wikipedia", "2026-09-22T00:00:00.000Z");

    const rows = await db.select().from(voiceActorAttributes);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      value: "うえだ れいな",
      recordedAt: "2026-09-22T00:00:00.000Z",
    });
  });

  it("同じ属性でも出どころが違えば別の行になり、片方を書いても他方は変わらない", async () => {
    const db = await setupDb();
    await writeAttribute(db, "うえだれいな", "wikipedia");

    await writeAttribute(db, "うえだ れいな", "editorial");

    const rows = await db
      .select({ source: voiceActorAttributes.source, value: voiceActorAttributes.value })
      .from(voiceActorAttributes)
      .orderBy(voiceActorAttributes.source);
    expect(rows).toEqual([
      { source: "editorial", value: "うえだ れいな" },
      { source: "wikipedia", value: "うえだれいな" },
    ]);
  });

  it("居ない声優には書けない", async () => {
    const db = await setupDb();
    await db.run("PRAGMA foreign_keys = ON");

    await expect(
      db.insert(voiceActorAttributes).values({
        voiceActorId: "va_nobody",
        attribute: "nameKana",
        source: "wikipedia",
        value: "だれか",
        recordedAt: NOW,
      }),
    ).rejects.toThrow();
  });
});

describe("voice_actors の同一性の列", () => {
  it("同じ staff id の声優は 2 行入らない", async () => {
    const db = await setupDb();

    await expect(
      db.insert(voiceActors).values({
        id: "va_ueda-reina-2",
        slug: "ueda-reina-2",
        canonicalName: "上田麗奈",
        anilistStaffId: UEDA.anilistStaffId,
        status: "active",
        gender: "female",
        firstSeenAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      }),
    ).rejects.toThrow();
  });

  it("投入で初めて見た日時が入り、同じ声優をもう一度投入しても初回の値のまま", async () => {
    const db = await setupDb([UEDA], "2026-09-01T00:00:00.000Z");

    await upsertActors(db, [UEDA], "2026-09-22T00:00:00.000Z");

    const [row] = await db
      .select({ firstSeenAt: voiceActors.firstSeenAt, updatedAt: voiceActors.updatedAt })
      .from(voiceActors)
      .where(eq(voiceActors.id, UEDA.id));
    expect(row).toEqual({
      firstSeenAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-22T00:00:00.000Z",
    });
  });

  it("マイグレーションを当てると、既に居た声優の初めて見た日時に作成日時が写る", async () => {
    const db = await createMigratedTestDb(BEFORE_ATTRIBUTES);
    await db.run(
      `INSERT INTO voice_actors (id, slug, canonical_name, anilist_staff_id, status, gender, created_at, updated_at)
       VALUES ('va_ueda-reina', 'ueda-reina', '上田麗奈', 100001, 'active', 'female',
               '2026-09-18T00:00:00.000Z', '2026-09-20T00:00:00.000Z')`,
    );

    await applyMigrationsAfter(db, BEFORE_ATTRIBUTES);

    const [row] = await db
      .select({ firstSeenAt: voiceActors.firstSeenAt, lastSeenSeason: voiceActors.lastSeenSeason })
      .from(voiceActors);
    expect(row).toEqual({ firstSeenAt: "2026-09-18T00:00:00.000Z", lastSeenSeason: null });
  });
});
