import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { ActorKanaRecord } from "./discovery/actor-kana.ts";
import { fetchActorKana, stopReasonFor } from "./discovery/wikipedia-kana.ts";
import { NO_KANA_REASON, refillActorKana } from "./discovery/wikipedia-kana-refill.ts";
import { type ActorKanaResult, AdminApiClient, type KanaTarget } from "./lib/ingest.ts";

/**
 * まだかなを引いていない声優のかなを取り、台帳に入れる。
 *
 *   INGEST_TOKEN=dev node crawler/kana.ts --base-url http://localhost:5199 --limit 50
 *
 * 誰を引くかは台帳が決める (`GET /api/admin/actor-kana`)。「かなを持っていない人」ではなく
 * 「引いていない人」なので、記事が無い声優を毎週引き直さない。取れても取れなくても
 * 結果を送り、送った相手には引いた印が付く。
 *
 * 引き方は既存の規則をそのまま使う。記事から読みが取れなければ、導入部と Wikidata を
 * 見る経路 (`wikipedia-kana-refill.ts`) に回す。
 * サイトの制約は `docs/stores/wikimedia.md`
 */

/** 1 回に引く人数の既定。週次の走行が他の仕事と合わせて収まる数 */
const DEFAULT_LIMIT = 100;
/** 何人ごとに進捗を出すか */
const PROGRESS_EVERY = 10;
/**
 * 何人ぶんたまったら台帳へ送るか。
 *
 * 全員引き終えてから送ると、走行が打ち切られたときに取った結果が丸ごと消え、
 * 次の週に同じ相手を引き直すことになる。相手サイトへの往復が二重になる
 */
const FLUSH_EVERY = 25;

const USAGE = `使い方:
  INGEST_TOKEN=... node crawler/kana.ts --base-url <URL> [オプション]

オプション:
  --base-url <URL>  台帳の場所。環境変数 INGEST_URL でも指定できる
  --limit <N>       この人数だけ引いて終わる (既定 ${DEFAULT_LIMIT})
  --dry-run         引くが送らない (誰が対象かだけ見たいとき)
  --snapshot        記事 HTML を .cache/snapshots に残す (1 件 1MB 超)
`;

const OPTION_SPEC = {
  "base-url": { type: "string" },
  limit: { type: "string" },
  "dry-run": { type: "boolean" },
  snapshot: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

/**
 * 取得結果を、台帳に送る形にする。
 *
 * 記事のどこから取っても `wikipedia`。Wikidata の項目から取ったものだけ分ける。
 * かなが取れなかった人は `kana` を省いて送る (引いた印だけが付く)
 */
export function toKanaResult(target: KanaTarget, record: ActorKanaRecord): ActorKanaResult {
  if (record.status !== "ok" || record.kana === undefined) {
    return { voiceActorId: target.id };
  }
  return {
    voiceActorId: target.id,
    kana: record.kana,
    source: record.source === "wikidata" ? "wikidata" : "wikipedia",
  };
}

/**
 * 引いた結果を台帳に残してよいか。
 *
 * 記事が無い (`not-found`) と、記事はあるが条件を満たさない (`rejected`) は、
 * 何度引いても同じなので印を付けてよい。**取得そのものの失敗 (`failed`) は残さない。**
 * 相手の一時的な不調でも印が付き、その声優のかなを二度と引き直せなくなるため
 */
export function shouldRecordAttempt(record: ActorKanaRecord): boolean {
  return record.status !== "failed";
}

/** 引けなかった理由を人が読む 1 行にする */
export function describeMiss(target: KanaTarget, record: ActorKanaRecord): string {
  return `${target.canonicalName}: ${record.reason ?? record.status}`;
}

/**
 * 1 人ぶん。記事から読みが取れなければ、導入部と Wikidata を見る経路に回す。
 *
 * 2 段にするのは、1 段目が「記事は本人のものだと確かめられたが読みが書かれていない」で
 * 止まるため。その人だけは追加で引く値打ちがある
 */
async function fetchOne(canonicalName: string, snapshot: boolean): Promise<ActorKanaRecord> {
  const first = await fetchActorKana(canonicalName, { snapshot });
  if (first.status === "rejected" && first.reason === NO_KANA_REASON) {
    return refillActorKana(first, { snapshot });
  }
  return first;
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

  const limitOption = asString(values.limit);
  const limit = limitOption === undefined ? DEFAULT_LIMIT : Number(limitOption);
  if (!Number.isInteger(limit) || limit < 1) {
    process.stderr.write(`--limit は 1 以上の整数を指定する: ${limitOption}\n`);
    return 1;
  }

  const client = new AdminApiClient(baseUrl, token);
  const targets = await client.listActorsNeedingKana(limit);
  process.stdout.write(`まだ引いていない声優: ${targets.length} 人 (上限 ${limit})\n`);
  if (targets.length === 0) {
    process.stdout.write("引き残しは無い\n");
    return 0;
  }
  if (values["dry-run"] === true) {
    for (const target of targets.slice(0, 20)) {
      process.stdout.write(`  ${target.canonicalName}\n`);
    }
    process.stdout.write("--dry-run なので引かずに終わる\n");
    return 0;
  }

  const snapshot = values.snapshot === true;
  const pending: ActorKanaResult[] = [];
  const misses: string[] = [];
  const saved = { written: 0, withoutKana: 0, skipped: 0 };
  let consecutiveFailures = 0;
  let stopped = false;

  /** たまったぶんを送る。送れた時点までは次の週に引き直さずに済む */
  const flush = async () => {
    if (pending.length === 0) return;
    const result = await client.writeActorKana(pending);
    saved.written += result.written;
    saved.withoutKana += result.withoutKana;
    saved.skipped += result.skipped;
    pending.length = 0;
  };

  for (const [index, target] of targets.entries()) {
    const record = await fetchOne(target.canonicalName, snapshot).catch(
      (error: unknown): ActorKanaRecord => ({
        canonicalName: target.canonicalName,
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
        fetchedAt: new Date().toISOString(),
      }),
    );
    if (record.status !== "ok") misses.push(describeMiss(target, record));
    if (shouldRecordAttempt(record)) pending.push(toKanaResult(target, record));

    // 相手の状態が変わったとき (締め出し、レート制限) は引き続けない
    consecutiveFailures = record.status === "failed" ? consecutiveFailures + 1 : 0;
    const stop = stopReasonFor(record, consecutiveFailures);
    if (stop !== undefined) {
      process.stderr.write(`[中断] ${stop.detail}\n`);
      stopped = true;
      break;
    }

    if (pending.length >= FLUSH_EVERY) await flush();
    if ((index + 1) % PROGRESS_EVERY === 0) {
      process.stdout.write(`  ${index + 1}/${targets.length} 人\n`);
    }
  }

  await flush();
  process.stdout.write(
    `かなを書いた: ${saved.written} 人 / 取れなかった: ${saved.withoutKana} 人\n`,
  );
  if (saved.skipped > 0) {
    process.stdout.write(`  台帳に居なくなっていた: ${saved.skipped} 人\n`);
  }
  for (const miss of misses.slice(0, 20)) process.stdout.write(`  引けず: ${miss}\n`);
  if (misses.length > 20) process.stdout.write(`  ほか ${misses.length - 20} 人\n`);

  // 中断は失敗として返す。0 を返すと、締め出されたことに誰も気づかない
  return stopped ? 1 : 0;
}

function asString(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

// 直接実行されたときだけ動かす (テストから import しても main が走らないようにするため)
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
