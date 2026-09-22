import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { AttributeSource } from "../../src/domain/index.ts";
import { type ActorAttributeSeed, AdminApiClient } from "../lib/ingest.ts";
import { type ActorKanaRecord, KANA_JSON, readKanaCache } from "./actor-kana.ts";

/**
 * 取得したかなを台帳へ送る。
 *
 *   INGEST_TOKEN=dev node crawler/discovery/write-actor-kana.ts --base-url http://localhost:5199
 *
 * `wikipedia-kana.ts` が `crawler/.cache/discovery/wikipedia-kana.json` に貯めた結果を読み、
 * 出どころ付きの行として `POST /api/admin/actor-attributes` に送る。ネットワークに出るのは
 * 取り込み先だけで、Wikipedia は引かない。
 *
 * 出どころごとに行が分かれるので、人が書いた訂正 (`editorial`) を上書きしない。
 * どの値を表に出すかは読み取り側が属性ごとの優先順位で決める
 */

/** 何件ずつ送るか。1 回の本文が大きくなりすぎないようにするだけ */
const CHUNK = 500;

const USAGE = `使い方:
  INGEST_TOKEN=... node crawler/discovery/write-actor-kana.ts --base-url <URL> [オプション]

オプション:
  --base-url <URL>  台帳の場所。環境変数 INGEST_URL でも指定できる
  --kana <path>     取得結果 (既定 crawler/.cache/discovery/wikipedia-kana.json)
  --dry-run         送らずに、何件送ることになるかだけ出す
`;

const OPTION_SPEC = {
  "base-url": { type: "string" },
  kana: { type: "string" },
  "dry-run": { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

/**
 * 記事のどこから取ったかを、台帳の出どころに写す。
 *
 * 記事の中の取り出し場所 (テンプレートの引数 / 名前そのもの / 導入部) は 3 通りあるが、
 * どれも同じ記事から取っているので台帳では `wikipedia` にまとめる。
 * Wikidata だけは別の情報源なので分ける
 */
export function toAttributeSource(source: ActorKanaRecord["source"]): AttributeSource {
  return source === "wikidata" ? "wikidata" : "wikipedia";
}

/**
 * 送る行を組み立てる。かなが取れた記録だけを、台帳に居る声優に絞って返す。
 *
 * 台帳に居ない名前が出るのは、取得の後に声優の日本語表記が変わったとき。
 * 送っても取り込み側が捨てるので、ここで数えて呼び出し側に見せる
 */
export function buildKanaSeeds(
  records: readonly ActorKanaRecord[],
  actorIdByName: ReadonlyMap<string, string>,
): { seeds: ActorAttributeSeed[]; unknownNames: string[] } {
  const seeds: ActorAttributeSeed[] = [];
  const unknownNames: string[] = [];

  for (const record of records) {
    if (record.status !== "ok" || record.kana === undefined) continue;
    const voiceActorId = actorIdByName.get(record.canonicalName);
    if (voiceActorId === undefined) {
      unknownNames.push(record.canonicalName);
      continue;
    }
    seeds.push({
      voiceActorId,
      attribute: "nameKana",
      source: toAttributeSource(record.source),
      value: record.kana,
    });
  }

  return { seeds, unknownNames };
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

  const baseUrl = asString(values["base-url"]) ?? process.env.INGEST_URL;
  const token = process.env.INGEST_TOKEN;
  if (baseUrl === undefined || baseUrl === "" || token === undefined || token === "") {
    process.stderr.write(`--base-url (か INGEST_URL) と INGEST_TOKEN が要る\n\n${USAGE}`);
    return 1;
  }

  const kanaFile = asString(values.kana) ?? KANA_JSON;
  const cache = await readKanaCache(kanaFile);
  if (cache === undefined) {
    process.stderr.write(`取得結果が無い: ${kanaFile}\n`);
    return 1;
  }

  const client = new AdminApiClient(baseUrl, token);
  const actorIdByName = new Map(
    (await client.listActors()).map((entry) => [entry.canonicalName, entry.id]),
  );
  const { seeds, unknownNames } = buildKanaSeeds(cache.records, actorIdByName);

  process.stdout.write(
    `取得結果 ${cache.records.length} 件のうち、かなが取れたのは ${seeds.length + unknownNames.length} 件\n`,
  );
  if (unknownNames.length > 0) {
    process.stdout.write(
      `  台帳に居ない名前は送らない: ${unknownNames.length} 件 ` +
        `(${unknownNames.slice(0, 5).join("、")})\n`,
    );
  }
  if (seeds.length === 0) {
    process.stdout.write("送るものが無い\n");
    return 0;
  }

  if (values["dry-run"] === true) {
    process.stdout.write(`--dry-run なので送らない (${seeds.length} 件)\n`);
    return 0;
  }

  const total = { written: 0, skipped: 0 };
  for (let start = 0; start < seeds.length; start += CHUNK) {
    const result = await client.writeActorAttributes(seeds.slice(start, start + CHUNK));
    total.written += result.written;
    total.skipped += result.skipped;
  }
  process.stdout.write(`書いた: ${total.written} 件 / 書かなかった: ${total.skipped} 件\n`);
  return 0;
}

function asString(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

// 直接実行されたときだけ動かす (テストから import しても main が走らないようにするため)
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
