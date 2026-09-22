import { inArray } from "drizzle-orm";
import { z } from "zod";
import { ATTRIBUTE_SOURCES, VOICE_ACTOR_ATTRIBUTES } from "@/domain/types";
import { chunked } from "../db/chunked";
import { voiceActorAttributes, voiceActors } from "../db/schema";
import type { AppDb } from "../db/types";

/**
 * 声優の付加情報の書き込み。
 *
 * 1 行は 声優 × 属性 × 出どころ。書き手は自分の出どころの行だけを書き、他の出どころの行を
 * 消したり上書きしたりしない。取り込みが人の訂正を消す経路も、その逆も持たないための形。
 * どの値を表に出すかは読み取り側が属性ごとの優先順位で決める (この表は順位を持たない)
 */

export const actorAttributeSeedSchema = z.object({
  voiceActorId: z.string().min(1),
  attribute: z.enum(VOICE_ACTOR_ATTRIBUTES),
  source: z.enum(ATTRIBUTE_SOURCES),
  value: z.string().min(1),
});

export type ActorAttributeSeed = z.infer<typeof actorAttributeSeedSchema>;

export type WriteActorAttributesResult = {
  /** 書いた行数 (新規と更新の合計) */
  written: number;
  /** 居ない声優を指していて書かなかった行数 */
  skipped: number;
};

/**
 * 付加情報を書く。同じ 声優 × 属性 × 出どころ が既にあれば値と記録日時を更新する。
 *
 * 居ない声優を指す行は外部キーで落ちるので、先に弾いて数える。
 * 1 行の失敗で残り全部を捨てると、1 回の取得ぶんがまるごと入らなくなる
 */
export async function writeActorAttributes(
  db: AppDb,
  seeds: readonly ActorAttributeSeed[],
  now: string = new Date().toISOString(),
): Promise<WriteActorAttributesResult> {
  const known = await knownActorIds(db, seeds);
  let written = 0;
  let skipped = 0;

  for (const seed of seeds) {
    if (!known.has(seed.voiceActorId)) {
      skipped += 1;
      continue;
    }
    await db
      .insert(voiceActorAttributes)
      .values({
        voiceActorId: seed.voiceActorId,
        attribute: seed.attribute,
        source: seed.source,
        value: seed.value,
        recordedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          voiceActorAttributes.voiceActorId,
          voiceActorAttributes.attribute,
          voiceActorAttributes.source,
        ],
        set: { value: seed.value, recordedAt: now },
      });
    written += 1;
  }

  return { written, skipped };
}

async function knownActorIds(
  db: AppDb,
  seeds: readonly ActorAttributeSeed[],
): Promise<Set<string>> {
  const ids = [...new Set(seeds.map((seed) => seed.voiceActorId))];
  const found = new Set<string>();
  for (const chunk of chunked(ids)) {
    const rows = await db
      .select({ id: voiceActors.id })
      .from(voiceActors)
      .where(inArray(voiceActors.id, chunk));
    for (const row of rows) found.add(row.id);
  }
  return found;
}
