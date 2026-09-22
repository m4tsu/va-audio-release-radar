import { getTableName, inArray, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import {
  ATTRIBUTE_SOURCES,
  type AttributeSource,
  VOICE_ACTOR_ATTRIBUTES,
  type VoiceActorAttribute,
} from "@/domain/types";
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

// --- 読み取り --------------------------------------------------------------

/**
 * かなを選ぶ順。手で書いたものが先で、取得したものはその後ろ。
 * Wikidata を Wikipedia より先にするのは、項目の読み (P1814) が記事の本文より構造化されていて、
 * 取り違えの余地が小さいため
 */
export const NAME_KANA_SOURCES = ["editorial", "wikidata", "wikipedia"] as const;

/**
 * 表示用ローマ字を選ぶ順。付加情報に無ければ供給元の写しの列に落ちる。
 * 取得した値の置き場は列のほうなので、ここに並ぶのは手で書いたものだけ
 */
export const NAME_EN_SOURCES = ["editorial"] as const;

/**
 * 副問い合わせの中から外側の声優を指す参照。表名を明示して書く。
 *
 * 列オブジェクトをそのまま埋めると、外側の問い合わせが 1 つの表しか持たないときに
 * 表名の付かない `"id"` になる。副問い合わせの中では内側の表の `id` が先に見つかるので、
 * 別の列と突き合わせる問い合わせに化けて、値が 1 件も返らなくなる
 */
const OUTER_ACTOR_ID = sql`${sql.identifier(getTableName(voiceActors))}.${sql.identifier("id")}`;

/**
 * 1 つの属性から、出どころの優先順位で値を 1 つ選ぶ相関副問い合わせ。
 *
 * 外側の問い合わせが `voice_actors` を含んでいることが前提。並べ替えを `case` で書くのは、
 * 優先順位をこの配列 1 か所に持たせるため。知らない出どころは最後に回す
 */
function pickAttribute(
  attribute: VoiceActorAttribute,
  sources: readonly AttributeSource[],
): SQL<string | null> {
  const ranks = sources.map((source, rank) => sql`when ${source} then ${rank}`);
  return sql<string | null>`(
    select ${voiceActorAttributes.value} from ${voiceActorAttributes}
    where ${voiceActorAttributes.voiceActorId} = ${OUTER_ACTOR_ID}
      and ${voiceActorAttributes.attribute} = ${attribute}
    order by case ${voiceActorAttributes.source} ${sql.join(ranks, sql` `)} else ${sources.length} end
    limit 1
  )`;
}

/** 画面に出すかな。旧列 `name_kana` は読まない */
export const resolvedNameKana: SQL<string | null> = pickAttribute("nameKana", NAME_KANA_SOURCES);

/** 画面に出すローマ字。手で書いたものが無ければ供給元の写しの列 */
export const resolvedNameEn: SQL<string | null> = sql<string | null>`coalesce(
  ${pickAttribute("nameEn", NAME_EN_SOURCES)}, ${voiceActors.nameEn}
)`;
