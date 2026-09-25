import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeName } from "../../src/domain/normalize.ts";
import type { ObservedActorRef, StoreActorRef } from "../adapters/types.ts";
import { CACHE_DIR, CRAWLER_DIR } from "../lib/paths.ts";

/**
 * ポケドラの声優タグ辞書を、クロール時に引ける形に直す。
 *
 * ポケドラは名前で検索しない。声優は `tag_id` というタグで、一覧の URL にその ID が要る。
 * 辞書は `crawler/pokedora-tags.generated.json` (git 管理) にあるので、ここではそれを読んで
 * 「正規化した名前 → tag_id」の対応にするだけ。ネットワークには出ない。
 * 生成は `build-pokedora-tags.ts`。
 *
 * **辞書に無い声優はポケドラを引かない**。名前から tag_id を引く API が無く
 * (`/sapi/json.php` は 404)、総当たりで探す手段が無いため。
 */

const DISCOVERY_DIR = path.join(CACHE_DIR, "discovery");
/** 声優タグ辞書 (生成物)。ポケドラは名前で引けないので、タグ id の対応だけを配る */
export const TAGS_GENERATED_JSON = path.join(CRAWLER_DIR, "pokedora-tags.generated.json");
/** クロール中に見えた (tag_id, 表記) の蓄積先 */
export const ACTOR_REFS_JSON = path.join(DISCOVERY_DIR, "pokedora-actor-refs.json");

/** 取得対象のストア区分。オトナ向け 2 つは引かない ([`docs/stores/pokedora.md`](../../docs/stores/pokedora.md)) */
export const TARGET_SECTIONS = ["men", "bl"] as const;
export type TargetCounts = Record<(typeof TARGET_SECTIONS)[number], number>;

/** 辞書 1 件。クロールに要るのは tag_id と名前と取得対象区分の件数だけ */
export type PokedoraTagEntry = {
  tagId: number;
  name: string;
  counts: TargetCounts;
};

/**
 * 引く価値がある声優か。取得対象の区分が全部 0 件なら引いても必ず 0 件で、
 * 区分ごとの 1 往復ぶんの待ち時間が無駄になる
 */
export function hasTargetWorks(counts: TargetCounts): boolean {
  return TARGET_SECTIONS.some((section) => counts[section] > 0);
}

/** 正規化した名前 → その名前に付いている tag_id (件数つき) */
export type PokedoraDirectory = ReadonlyMap<string, StoreActorRef[]>;

/**
 * 辞書の項目から対応表を作る。
 *
 * 同じ名前に複数の tag_id が付いている組があり
 * ([`docs/stores/pokedora.md`](../../docs/stores/pokedora.md) の「既知の落とし穴」)、
 * どちらが目当ての人かは辞書だけでは決められないので、件数のあるものを全部返して
 * adapter に和集合を取らせる
 */
export function buildDirectory(entries: readonly PokedoraTagEntry[]): PokedoraDirectory {
  const directory = new Map<string, StoreActorRef[]>();

  for (const entry of entries) {
    if (!hasTargetWorks(entry.counts)) continue;

    const key = normalizeName(entry.name);
    const ref: StoreActorRef = { externalId: String(entry.tagId), counts: { ...entry.counts } };
    const bucket = directory.get(key);
    if (bucket === undefined) directory.set(key, [ref]);
    else bucket.push(ref);
  }
  return directory;
}

/**
 * 辞書 1 件として読める形か。読めない項目を落として残りで進むのは、
 * 1 件の欠けでポケドラ全体を諦めないため (辞書が無いときだけ全員分を飛ばす)
 */
function isTagEntry(value: unknown): value is PokedoraTagEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<PokedoraTagEntry>;
  if (!Number.isInteger(entry.tagId) || typeof entry.name !== "string" || entry.name === "") {
    return false;
  }
  const counts: Partial<TargetCounts> | undefined = entry.counts;
  if (typeof counts !== "object" || counts === null) return false;
  return TARGET_SECTIONS.every((section) => Number.isInteger(counts[section]));
}

/**
 * 辞書ファイルを読む。無ければ undefined を返し、呼び出し側に
 * 「ポケドラは引けない」と判断させる。例外にしないのは、辞書を持たない環境でも
 * DLsite と Audible のクロールは走らせたいため
 */
export async function loadPokedoraDirectory(
  file: string = TAGS_GENERATED_JSON,
): Promise<PokedoraDirectory | undefined> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  return buildDirectory(parsed.filter(isTagEntry));
}

/** 声優 1 人ぶんの tag_id を引く。見つからなければ undefined (= ポケドラを引かない) */
export function lookupActor(
  directory: PokedoraDirectory | undefined,
  canonicalName: string,
): StoreActorRef[] | undefined {
  return directory?.get(normalizeName(canonicalName));
}

// --- クロール中に見えた tag_id の蓄積 --------------------------------------

/**
 * 1 つの tag_id について観測したこと。
 *
 * `names` を配列で持つのは、同じ tag_id に別の表記が付いて見えたときにそれを残すため。
 * 「同じ tag_id なら同一人物」はストア由来の事実なので、そこに 2 つの表記が並べば
 * それが別名義 / 表記揺れの根拠になる
 */
export type PokedoraActorRefRecord = {
  tagId: number;
  names: string[];
  /** 出演クレジットとして見えた回数 */
  seenCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type PokedoraActorRefsCache = {
  updatedAt: string;
  records: PokedoraActorRefRecord[];
};

/**
 * 観測した (tag_id, 表記) を既存の記録に畳み込む。純粋関数にしてあるのでテストできる。
 * 同じ作品に同じ人が二度出ることはないので、observed はそのまま数える
 */
export function mergeActorRefs(
  existing: readonly PokedoraActorRefRecord[],
  observed: readonly ObservedActorRef[],
  now: string,
): PokedoraActorRefRecord[] {
  const byTagId = new Map<number, PokedoraActorRefRecord>();
  for (const record of existing) byTagId.set(record.tagId, { ...record, names: [...record.names] });

  for (const ref of observed) {
    const tagId = Number(ref.externalId);
    if (!Number.isInteger(tagId)) continue;
    const found = byTagId.get(tagId);
    if (found === undefined) {
      byTagId.set(tagId, {
        tagId,
        names: [ref.name],
        seenCount: 1,
        firstSeenAt: now,
        lastSeenAt: now,
      });
      continue;
    }
    if (!found.names.includes(ref.name)) found.names.push(ref.name);
    found.seenCount += 1;
    found.lastSeenAt = now;
  }
  return [...byTagId.values()].sort((a, b) => a.tagId - b.tagId);
}

/**
 * 観測結果をファイルに足す。
 *
 * DB ではなくクローラー側のキャッシュに置いている。tag_id を DB まで運ぶには
 * `RawWork` / `IngestPayload` に項目を足す必要があり、走行中の他ストアのクロールに
 * 影響する版上げを伴う。また観測した tag_id に 2 つ以上の表記を持つものが無く、別名義の根拠にも
 * ならない。入れるなら (store_slug, external_id) が一意な別の表にする。`voice_actor_aliases` は
 * 名寄せの索引なので、名前でない文字列を混ぜない。
 * 一時ファイルに書いてから rename するのは、長いクロールの途中で中断されても
 * JSON が壊れないようにするため
 */
export async function appendActorRefs(
  observed: readonly ObservedActorRef[],
  now: string = new Date().toISOString(),
  file: string = ACTOR_REFS_JSON,
): Promise<number> {
  if (observed.length === 0) return 0;

  let existing: PokedoraActorRefRecord[] = [];
  try {
    const cache = JSON.parse(await readFile(file, "utf8")) as PokedoraActorRefsCache;
    if (Array.isArray(cache.records)) existing = cache.records;
  } catch {
    // まだ無い / 壊れている。作り直す
  }

  const records = mergeActorRefs(existing, observed, now);
  const cache: PokedoraActorRefsCache = { updatedAt: now, records };
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  await rename(temporary, file);
  return records.length;
}
