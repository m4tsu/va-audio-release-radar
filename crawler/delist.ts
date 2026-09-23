import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { buildProductJsonUrl, isDelisted, parseProductJson } from "./adapters/dlsite.ts";
import { fetchText } from "./lib/fetch.ts";
import { AdminApiClient, type Delisting } from "./lib/ingest.ts";

/**
 * 台帳が持っている DLsite の作品を引き直し、もう買えないものを取り下げる。
 *
 *   INGEST_TOKEN=dev node crawler/delist.ts --base-url http://localhost:5199 --limit 100
 *
 * **声優起点の走行ではこれができない。** ストアの検索結果には売っている作品しか出ないので、
 * 買えなくなった作品は検索から消え、詳細を引き直す機会そのものが無くなる
 * (2026-09-23 の測定、`docs/research/dlsite-on-sale-2026-09-23.md` で、一覧由来 2,138 件は
 * すべて販売中だった)。だから台帳の商品 ID を起点にする。
 *
 * 判定が付かなかった作品は送らない。送ると「買える」という主張になり、
 * 前に付いた取り下げを取り消してしまう。
 * サイトの制約は `docs/stores/dlsite.md`
 */

const STORE = "dlsite";
/** 何件ごとに台帳へ送るか。打ち切られても、送れた時点までは次の月に引き直さずに済む */
const FLUSH_EVERY = 50;
/** 何件ごとに進捗を出すか */
const PROGRESS_EVERY = 25;
/** 同じ失敗がこれだけ続いたら、相手の状態が変わったとみなして止める */
const CONSECUTIVE_FAILURE_LIMIT = 10;

const USAGE = `使い方:
  INGEST_TOKEN=... node crawler/delist.ts --base-url <URL> [オプション]

オプション:
  --base-url <URL>  台帳の場所。環境変数 INGEST_URL でも指定できる
  --offset <N>      先頭 N 件を飛ばす (--limit と併用して途中から再開する)
  --limit <N>       この件数だけ引いて終わる (既定: 全件)
  --dry-run         引くが送らない
  --no-snapshot     取得した生データを .cache/snapshots に保存しない
`;

const OPTION_SPEC = {
  "base-url": { type: "string" },
  offset: { type: "string" },
  limit: { type: "string" },
  "dry-run": { type: "boolean" },
  "no-snapshot": { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

/** 1 件ぶんの結果。判定が付かなかった作品は `delisted` を持たない */
export type ProbeResult = { storeProductId: string; delisted?: boolean; reason?: string };

/**
 * 応答 1 件から判定を作る。
 *
 * `[]` が返る作品は「引けない」であって「買えない」ではない。R18 のフロアにしか無い作品も
 * `/home/` の API では空配列になる (`docs/stores/dlsite.md`)。判定を付けずに置く
 */
export function toProbeResult(storeProductId: string, body: string): ProbeResult {
  const detail = parseProductJson(body);
  if (detail === undefined) {
    return { storeProductId, reason: "product.json を解釈できなかった" };
  }
  const delisted = isDelisted(detail);
  if (delisted === undefined) {
    return { storeProductId, reason: "販売中かどうかを読めなかった" };
  }
  return { storeProductId, delisted };
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

  const offset = nonNegativeInteger(values.offset, 0);
  if (offset === undefined) {
    process.stderr.write(`--offset は 0 以上の整数を指定する: ${String(values.offset)}\n`);
    return 1;
  }
  const limitOption = asString(values.limit);
  const limit = limitOption === undefined ? undefined : Number(limitOption);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    process.stderr.write(`--limit は 1 以上の整数を指定する: ${limitOption}\n`);
    return 1;
  }

  const client = new AdminApiClient(baseUrl, token);
  // 台帳が持っている商品 ID。取り下げ済みの作品も返る (また買えるようになることがある)
  const all = [...(await client.knownIds(STORE))].sort();
  const targets = all.slice(offset, limit === undefined ? undefined : offset + limit);
  process.stdout.write(
    `台帳の ${STORE} の作品: ${all.length} 件 / 今回引く: ${targets.length} 件` +
      `${offset > 0 ? ` (${offset} 件目から)` : ""}\n`,
  );
  if (targets.length === 0) {
    process.stdout.write("引くものが無い\n");
    return 0;
  }

  const snapshot = values["no-snapshot"] !== true;
  const dryRun = values["dry-run"] === true;
  const pending: Delisting[] = [];
  const saved = { delisted: 0, relisted: 0, unknown: 0 };
  const skipped: string[] = [];
  let decided = 0;
  let consecutiveFailures = 0;
  let stopped = false;

  const flush = async () => {
    if (pending.length === 0) return;
    // --dry-run でも溜めたぶんは捨てる。全件ぶんを抱えたまま走らせないため
    if (dryRun) {
      pending.length = 0;
      return;
    }
    const result = await client.recordDelistings(pending);
    saved.delisted += result.delisted;
    saved.relisted += result.relisted;
    saved.unknown += result.unknown;
    pending.length = 0;
  };

  for (const [index, storeProductId] of targets.entries()) {
    const response = await fetchText(buildProductJsonUrl(storeProductId), {
      store: STORE,
      requestKey: `product-${storeProductId}`,
      kind: "json",
      snapshot,
    });

    if (!response.ok) {
      // 取得そのものの失敗は判定にしない。相手の不調で作品を取り下げないため
      skipped.push(`${storeProductId}: 取得に失敗 (${response.reason})`);
      consecutiveFailures += 1;
      if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
        process.stderr.write(
          `[中断] ${consecutiveFailures} 件続けて取得に失敗した (最後: ${storeProductId})\n`,
        );
        stopped = true;
        break;
      }
      continue;
    }
    consecutiveFailures = 0;

    const probe = toProbeResult(storeProductId, response.body);
    if (probe.delisted === undefined) {
      skipped.push(`${storeProductId}: ${probe.reason ?? "判定できなかった"}`);
    } else {
      decided += 1;
      pending.push({ storeSlug: STORE, storeProductId, delisted: probe.delisted });
    }

    if (pending.length >= FLUSH_EVERY) await flush();
    if ((index + 1) % PROGRESS_EVERY === 0) {
      process.stdout.write(`  ${index + 1}/${targets.length} 件\n`);
    }
  }

  await flush();
  if (dryRun) {
    process.stdout.write(`--dry-run なので送らない (判定が付いたのは ${decided} 件)\n`);
    return stopped ? 1 : 0;
  }

  process.stdout.write(
    `取り下げた: ${saved.delisted} 件 / また買えるようになった: ${saved.relisted} 件\n`,
  );
  if (saved.unknown > 0) {
    process.stdout.write(`  台帳に無くなっていた: ${saved.unknown} 件\n`);
  }
  if (skipped.length > 0) {
    process.stdout.write(`判定を付けずに置いた: ${skipped.length} 件\n`);
    for (const line of skipped.slice(0, 10)) process.stdout.write(`  ${line}\n`);
    if (skipped.length > 10) process.stdout.write(`  ほか ${skipped.length - 10} 件\n`);
  }

  return stopped ? 1 : 0;
}

function asString(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function nonNegativeInteger(
  value: string | boolean | undefined,
  fallback: number,
): number | undefined {
  const text = asString(value);
  if (text === undefined) return fallback;
  const parsed = Number(text);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

// 直接実行されたときだけ動かす (テストから import しても main が走らないようにするため)
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
