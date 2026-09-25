import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { asString } from "../lib/cli.ts";
import { writeJsonAtomic } from "../lib/json-file.ts";
import { CACHE_DIR } from "../lib/paths.ts";
import {
  hasTargetWorks,
  type PokedoraTagEntry,
  TAGS_GENERATED_JSON,
} from "./pokedora-directory.ts";
import type { PokedoraTagRecord, PokedoraTagsCache } from "./pokedora-tags.ts";

/**
 * ポケドラの声優タグ辞書の生成。
 *
 *   node crawler/discovery/build-pokedora-tags.ts
 *
 * 一度きりのバッチ (`pokedora-tags.ts`) が `.cache/discovery/pokedora-tags.json` に残した
 * 全タグの記録から、クロールに要るものだけを抜いて `crawler/pokedora-tags.generated.json` を作る。
 * ネットワークには出ない。
 *
 * 落とすもの:
 *
 * - 名前か件数が取れなかった記録。名前で引けないので辞書に載せても使えない
 * - 取得対象の区分 (一般 / BL) が 0 件の声優。引いても必ず 0 件になる
 * - `httpStatus` / `fetchedAt` / 取得しない区分 (オトナ向け 2 つ) の件数。クロールが見ない
 *
 * 落とす前の記録は `.cache` に残る
 */

const DEFAULT_TAGS_JSON = path.join(CACHE_DIR, "discovery", "pokedora-tags.json");

const USAGE = `使い方:
  node crawler/discovery/build-pokedora-tags.ts [オプション]

オプション:
  --tags <path>     一度きりのバッチの結果 (既定 crawler/.cache/discovery/pokedora-tags.json)
  --out <path>      出力先 (既定 crawler/pokedora-tags.generated.json)
  --allow-shrink    今ある出力より件数が減っても書き出す
`;

const OPTION_SPEC = {
  tags: { type: "string" },
  out: { type: "string" },
  "allow-shrink": { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

/**
 * 記録を辞書の項目に切り詰める。載せられないものは undefined。
 * 純粋関数にしてあるのでテストできる
 */
export function toTagEntry(record: PokedoraTagRecord): PokedoraTagEntry | undefined {
  if (record.status !== "ok" || record.name === undefined || record.counts === undefined) {
    return undefined;
  }
  const counts = { men: record.counts.men, bl: record.counts.bl };
  if (!hasTargetWorks(counts)) return undefined;
  return { tagId: record.tagId, name: record.name, counts };
}

/**
 * tag_id の昇順に並べる (差分を人が読めるようにするため)。
 * 同じ tag_id が 2 度出てきたら先に見たほうを残す。辞書は tag_id で引くので、
 * 重複が残ると同じ声優を 2 回引くことになる
 */
export function buildTagEntries(records: readonly PokedoraTagRecord[]): PokedoraTagEntry[] {
  const byTagId = new Map<number, PokedoraTagEntry>();
  for (const record of records) {
    const entry = toTagEntry(record);
    if (entry !== undefined && !byTagId.has(entry.tagId)) byTagId.set(entry.tagId, entry);
  }
  return [...byTagId.values()].sort((a, b) => a.tagId - b.tagId);
}

/**
 * 今ある出力の件数。まだ無ければ 0、読めたが配列でなければ undefined。
 *
 * 生成元は `.cache` にあって追跡されないのに、出力は追跡される。
 * 途中まで取った `.cache` しか持たない場所で生成し直すと、辞書が黙って痩せた出力ができる。
 * 書き出す前に気づけるよう数える。
 * 配列でないものを 0 件として扱うと、出力が壊れているときに痩せた生成が素通りする
 */
export async function existingEntryCount(outFile: string): Promise<number | undefined> {
  let text: string;
  try {
    text = await readFile(outFile, "utf8");
  } catch {
    // まだ出力が無い。比べる相手が無いので減りようもない
    return 0;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.length : undefined;
  } catch {
    return undefined;
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  let values: Record<string, string | boolean | undefined>;
  try {
    values = parseArgs({ args: [...argv], options: OPTION_SPEC }).values;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 1;
  }

  if (values.help === true) {
    process.stdout.write(USAGE);
    return 0;
  }

  const tagsFile = asString(values.tags) ?? DEFAULT_TAGS_JSON;
  const outFile = asString(values.out) ?? TAGS_GENERATED_JSON;

  let cache: PokedoraTagsCache;
  try {
    cache = JSON.parse(await readFile(tagsFile, "utf8")) as PokedoraTagsCache;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${tagsFile} を読めない: ${detail}\n`);
    process.stderr.write("取得は node crawler/discovery/pokedora-tags.ts --resume\n");
    return 1;
  }
  if (!Array.isArray(cache.records)) {
    process.stderr.write(`${tagsFile} に records 配列が無い\n`);
    return 1;
  }

  const entries = buildTagEntries(cache.records);
  process.stdout.write(`記録: ${cache.records.length} 件 (${tagsFile})\n`);
  process.stdout.write(`  辞書に載せる: ${entries.length} 件 (一般 + BL に作品がある声優)\n`);
  process.stdout.write(`  載せない: ${cache.records.length - entries.length} 件\n`);

  const previous = await existingEntryCount(outFile);
  const allowShrink = values["allow-shrink"] === true;
  if (previous === undefined && !allowShrink) {
    process.stderr.write(
      `\n[エラー] 今ある ${outFile} を配列として読めないので、件数を比べられない\n`,
    );
    process.stderr.write("  出力を git で戻すか、承知のうえなら --allow-shrink を付ける\n");
    return 1;
  }
  if (previous !== undefined && entries.length < previous && !allowShrink) {
    process.stderr.write(
      `\n[エラー] 今ある ${outFile} の ${previous} 件が ${entries.length} 件に減るので書き出さない\n`,
    );
    process.stderr.write(
      `  ${tagsFile} が全件そろっているか確かめる ` +
        "(取得は node crawler/discovery/pokedora-tags.ts --resume)。\n" +
        "  減らすつもりなら --allow-shrink を付ける\n",
    );
    return 1;
  }

  await writeJsonAtomic(outFile, entries);
  process.stdout.write(`\n書き出した: ${outFile}\n`);
  return 0;
}

// 直接実行されたときだけ動かす (テストから import しても main が走らないようにするため)
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
