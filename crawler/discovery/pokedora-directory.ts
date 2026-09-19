import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeName } from "../../src/domain/normalize.ts";
import type { ObservedActorRef, StoreActorRef } from "../adapters/types.ts";
import { CACHE_DIR } from "../lib/paths.ts";
import type { PokedoraTagRecord, PokedoraTagsCache } from "./pokedora-tags.ts";

/**
 * ポケドラの声優タグ辞書 (段階 1 の成果) を、クロール時に引ける形に直す (T23)。
 *
 * ポケドラは名前で検索しない。声優は `tag_id` というタグで、一覧の URL にその ID が要る。
 * 辞書は 3,161 件の一度きりのバッチで作ってあるので (`pokedora-tags.ts`)、
 * ここではそれを読んで「正規化した名前 → tag_id」の対応にするだけ。ネットワークには出ない。
 *
 * **辞書に無い声優はポケドラを引かない**。名前から tag_id を引く API が無く
 * (`/sapi/json.php` は 404)、総当たりで探す手段が無いため。
 * 一般 + BL が 0 件と分かっている声優も引かない。段階 3 の所要が 3.3 時間から
 * 1.6 時間に縮む (ポケドラ交差調査 §7-1)
 */

const DISCOVERY_DIR = path.join(CACHE_DIR, "discovery");
export const TAGS_JSON = path.join(DISCOVERY_DIR, "pokedora-tags.json");
/** クロール中に見えた (tag_id, 表記) の蓄積先 */
export const ACTOR_REFS_JSON = path.join(DISCOVERY_DIR, "pokedora-actor-refs.json");

/** 取得対象のストア区分。オトナ向け 2 つは引かない (設計書 §14) */
const TARGET_SECTIONS = ["men", "bl"] as const;

/** 正規化した名前 → その名前に付いている tag_id (件数つき) */
export type PokedoraDirectory = ReadonlyMap<string, StoreActorRef[]>;

/**
 * 辞書の記録から対応表を作る。
 *
 * 一般 + BL が 0 件の tag_id は落とす。引いても必ず 0 件で、5 秒の往復が無駄になるため。
 * 同じ名前に複数の tag_id が付いている組が 7 つあり (ポケドラ交差調査 §8)、
 * どちらが目当ての人かは辞書だけでは決められないので、件数のあるものを全部返して
 * adapter に和集合を取らせる
 */
export function buildDirectory(records: readonly PokedoraTagRecord[]): PokedoraDirectory {
  const directory = new Map<string, StoreActorRef[]>();

  for (const record of records) {
    if (record.status !== "ok" || record.name === undefined || record.counts === undefined) {
      continue;
    }
    const counts = { men: record.counts.men, bl: record.counts.bl };
    if (TARGET_SECTIONS.every((section) => counts[section] === 0)) continue;

    const key = normalizeName(record.name);
    const ref: StoreActorRef = { externalId: String(record.tagId), counts };
    const bucket = directory.get(key);
    if (bucket === undefined) directory.set(key, [ref]);
    else bucket.push(ref);
  }
  return directory;
}

/**
 * 辞書ファイルを読む。無ければ undefined を返し、呼び出し側に
 * 「ポケドラは引けない」と判断させる。例外にしないのは、辞書を作っていない環境でも
 * DLsite と Audible のクロールは走らせたいため
 */
export async function loadPokedoraDirectory(
  file: string = TAGS_JSON,
): Promise<PokedoraDirectory | undefined> {
  let cache: PokedoraTagsCache;
  try {
    cache = JSON.parse(await readFile(file, "utf8")) as PokedoraTagsCache;
  } catch {
    return undefined;
  }
  if (!Array.isArray(cache.records)) return undefined;
  return buildDirectory(cache.records);
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
 * それが別名義 / 表記揺れの根拠になる (設計書 §3)
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
 * 影響する版上げを伴うため、今回はそこまで踏み込まない (T23 の報告を参照)。
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
