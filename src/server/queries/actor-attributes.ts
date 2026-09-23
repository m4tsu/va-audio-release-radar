import { asc, getTableName, inArray, isNull, type SQL, sql } from "drizzle-orm";
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
  seeds: readonly { voiceActorId: string }[],
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

/** かなを引く相手。日本語表記で引くので、名前と ID だけあればよい */
export type KanaTarget = { id: string; canonicalName: string };

/**
 * まだかなを引いていない声優。古い順に返す。
 *
 * 「かなを持っていない人」ではなく「引いていない人」で選ぶ。記事が無い声優は引いても
 * 取れないので、持っていないことを条件にすると毎週引き直すことになる
 */
export async function listActorsNeedingKana(db: AppDb, limit: number): Promise<KanaTarget[]> {
  return db
    .select({ id: voiceActors.id, canonicalName: voiceActors.canonicalName })
    .from(voiceActors)
    .where(isNull(voiceActors.nameKanaCheckedAt))
    .orderBy(asc(voiceActors.firstSeenAt), asc(voiceActors.id))
    .limit(limit);
}

/** 1 人ぶんの取得結果。かなが取れなかった人も、引いたことを残すために送る */
export const actorKanaResultSchema = z.object({
  voiceActorId: z.string().min(1),
  kana: z.string().min(1).optional(),
  /** かなが取れたときだけ。記事なら wikipedia、Wikidata の項目なら wikidata */
  source: z.enum(["wikipedia", "wikidata"]).optional(),
});

export type ActorKanaResult = z.infer<typeof actorKanaResultSchema>;

export type WriteActorKanaResult = {
  /** かなを書いた人数 */
  written: number;
  /** 引いたが取れなかった人数 */
  withoutKana: number;
  /** 台帳に居なくて何も書かなかった人数 */
  skipped: number;
};

/**
 * 取得結果を台帳に入れる。かなが取れた人は付加情報の行を書き、
 * **取れなかった人も含めて全員に「引いた」印を付ける**。
 *
 * 印を付けないと、記事が無い声優を毎週引き直す。付ける相手を取れた人だけにしても同じ
 */
export async function writeActorKana(
  db: AppDb,
  results: readonly ActorKanaResult[],
  now: string = new Date().toISOString(),
): Promise<WriteActorKanaResult> {
  const known = await knownActorIds(
    db,
    results.map((result) => ({ voiceActorId: result.voiceActorId })),
  );
  const found = results.filter(
    (result) => known.has(result.voiceActorId) && result.kana !== undefined,
  );

  await writeActorAttributes(
    db,
    found.map((result) => ({
      voiceActorId: result.voiceActorId,
      attribute: "nameKana" as const,
      source: result.source ?? ("wikipedia" as const),
      value: result.kana ?? "",
    })),
    now,
  );

  const attempted = results.filter((result) => known.has(result.voiceActorId));
  for (const chunk of chunked(attempted.map((result) => result.voiceActorId))) {
    await db
      .update(voiceActors)
      .set({ nameKanaCheckedAt: now })
      .where(inArray(voiceActors.id, chunk));
  }

  return {
    written: found.length,
    withoutKana: attempted.length - found.length,
    skipped: results.length - attempted.length,
  };
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
 * 別の列と突き合わせる問い合わせに化けて、値が 1 件も返らなくなる。
 *
 * 表名を直書きしているので、`voice_actors` に別名を付けた問い合わせからは使えない
 */
const OUTER_ACTOR_ID = sql`${sql.identifier(getTableName(voiceActors))}.${sql.identifier("id")}`;

/**
 * 1 つの属性から、出どころの優先順位で値を 1 つ選ぶ相関副問い合わせ。
 *
 * 外側の問い合わせが `voice_actors` を含んでいることが前提。出どころごとの副問い合わせを
 * 配列の順に `coalesce` で並べるので、優先順位はこの配列 1 か所に持たせたままになる。
 *
 * **並べた出どころ以外は選ばない。** 最後に回すだけにすると、順位を決めていない出どころの行が
 * 表に出る。1 つの属性に同じ出どころは 1 行しか無く (表の一意制約)、値は NOT NULL なので、
 * 最初に見つかった出どころの値がそのまま選ばれる。
 *
 * 出どころを 1 つずつ等号で引くのは、一意索引を 1 回ずつ突くだけで済ませるため。
 * `in` と `order by` で書くより D1 の読み取り行数が少なく、全声優を並べる一覧で効く
 */
function pickAttribute(
  attribute: VoiceActorAttribute,
  sources: readonly AttributeSource[],
): SQL<string | null> {
  const perSource = sources.map(
    (source) => sql`(
    select ${voiceActorAttributes.value} from ${voiceActorAttributes}
    where ${voiceActorAttributes.voiceActorId} = ${OUTER_ACTOR_ID}
      and ${voiceActorAttributes.attribute} = ${attribute}
      and ${voiceActorAttributes.source} = ${source}
  )`,
  );
  // coalesce は引数を 2 つ以上とるので、出どころが 1 つなら副問い合わせをそのまま返す
  return perSource.length === 1
    ? (perSource[0] as SQL<string | null>)
    : sql<string | null>`coalesce(${sql.join(perSource, sql`, `)})`;
}

/** 画面に出すかな。旧列 `name_kana` は読まない */
export const resolvedNameKana: SQL<string | null> = pickAttribute("nameKana", NAME_KANA_SOURCES);

/** 画面に出すローマ字。手で書いたものが無ければ供給元の写しの列 */
export const resolvedNameEn: SQL<string | null> = sql<string | null>`coalesce(
  ${pickAttribute("nameEn", NAME_EN_SOURCES)}, ${voiceActors.nameEn}
)`;
