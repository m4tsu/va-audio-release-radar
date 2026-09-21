import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  INGEST_PROTOCOL_VERSION,
  type IngestPayload,
  STORE_SLUGS,
  type StoreSlug,
} from "../src/domain/index.ts";
import { audibleAdapter } from "./adapters/audible.ts";
import { dlsiteAdapter } from "./adapters/dlsite.ts";
import { pokedoraAdapter } from "./adapters/pokedora.ts";
import type { FeedResult, SourceAdapter } from "./adapters/types.ts";
import {
  AdminApiClient,
  AdminApiError,
  failureReport,
  IngestProtocolMismatchError,
  type IngestResponse,
} from "./lib/ingest.ts";
import { STORE_LABELS } from "./lib/labels.ts";

/**
 * 日次の走行。ストアの新着一覧を引き、まだ知らない作品だけを取り込みに送る
 * (`docs/decisions/0007-daily-crawl-from-store-feeds.md`)。
 *
 *   INGEST_TOKEN=dev node crawler/daily.ts --base-url http://localhost:5199
 *
 * 声優起点の走行 (`crawler/run.ts`) と違い、誰の作品かをクローラーは決めない。
 * 出演者名を対象声優に照合するのは取り込み側で、1 人も当たらなかった作品は保存されない。
 * その作品の出演者名はどこにも残らない (拾えない範囲は上の決定記録の「帰結」)。
 *
 * 新着一覧を持たないストアは対象外。`fetchNewReleases` を実装した adapter だけが回る
 */

/** 新着一覧を実装した adapter。他のストアは後続の issue で足す */
const FEED_ADAPTERS: readonly SourceAdapter[] = [dlsiteAdapter, audibleAdapter, pokedoraAdapter];

const USAGE = `使い方:
  INGEST_TOKEN=... node crawler/daily.ts --base-url https://example.workers.dev [オプション]

オプション:
  --base-url <URL>          取り込み先。環境変数 INGEST_URL でも指定できる
  --store <slug>            1 つのストアだけを対象にする (新着一覧を持つストアのみ)
  --dry-run                 取得はするが DB へは送らない。既知の作品も分からなくなるので
                            一覧に出た全件の詳細を取る
  --no-snapshot             取得した生データを .cache/snapshots に保存しない
`;

const OPTION_SPEC = {
  "base-url": { type: "string" },
  store: { type: "string" },
  "dry-run": { type: "boolean" },
  "no-snapshot": { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

/**
 * `runStore` が使う取り込み先。`AdminApiClient` がそのまま当てはまる。
 * 型を絞ってあるのは、送る形をテストから確かめられるようにするため
 */
export type IngestTarget = {
  knownIds(storeSlug: StoreSlug): Promise<Set<string>>;
  ingest(payload: IngestPayload): Promise<IngestResponse>;
};

/** 1 ストアぶんの結果。標準出力の 1 行になる */
export type FeedOutcome = {
  storeSlug: StoreSlug;
  status: FeedResult["status"];
  /** 新着一覧に出た作品数 */
  listed: number;
  /** 既知を除いて詳細まで取り、送った作品数 */
  sent: number;
  /** 取り込みが保存した作品数 (対象声優に当たったもの) */
  saved?: number;
  /** 取り込みが「対象声優が居ない」として捨てた作品数 */
  dropped?: number;
  /** 引くつもりだった一覧をすべて取れたか */
  complete: boolean;
  /** 実際に取れた一覧ページ数。DLsite は引くフロアの数 */
  pages: number;
  reason?: string;
  warnings: string[];
};

/**
 * 結果の 1 行。件数は減っていく順に並ぶが、差が 1 つの理由に対応するとは限らない。
 * 一覧 → 新規 では既知のぶんと、ストアごとの理由で落としたぶん (許可外の年齢区分、
 * 出演者が分からない) が、新規 → 保存 では対象声優が居ないぶんが落ちる。理由は警告に出る。
 * 送っていない走行 (--dry-run) では保存と破棄が出ない
 */
export function formatOutcome(outcome: FeedOutcome): string {
  const label = STORE_LABELS[outcome.storeSlug];
  // 引けなかった入口があったことは件数からは読めないので、行の頭で言う。
  // status が error でも起こる (片方のフロアが落ち、もう片方が 0 件だった場合)
  const status = outcome.complete ? outcome.status : `${outcome.status} (一覧の一部を引けず)`;
  // ページ数も出すのは、相手サイトへの往復が増えていないことを後からログで確かめるため
  const counts = [`一覧 ${outcome.listed} 件 (${outcome.pages} ページ)`, `新規 ${outcome.sent} 件`];
  if (outcome.saved !== undefined) counts.push(`保存 ${outcome.saved} 件`);
  if (outcome.dropped !== undefined) counts.push(`対象声優なしで破棄 ${outcome.dropped} 件`);
  const reason = outcome.reason === undefined ? "" : ` (${outcome.reason})`;
  return `${label} ${status} ${counts.join(" / ")}${reason}`;
}

/**
 * 既知の作品 ID。取れなくても走行は止めない。止めると `crawl_runs` に行が残らず、
 * 走行が動かなかったのか新作が無かったのかを後から区別できなくなる。
 * 既知が分からなければ全件の詳細を取り直すだけで済む (`crawler/run.ts` の `loadKnownIds` と同じ扱い)
 */
async function loadKnownIds(
  client: IngestTarget | undefined,
  storeSlug: StoreSlug,
  warnings: string[],
): Promise<ReadonlySet<string> | undefined> {
  // 送らない走行では引かない。DB に触れずに取得部分だけ試せるようにするため
  if (client === undefined) return undefined;
  try {
    return await client.knownIds(storeSlug);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    warnings.push(`known-ids を取れなかった (${reason})。既知の作品も取り直す`);
    return undefined;
  }
}

export async function runStore(
  adapter: SourceAdapter,
  client: IngestTarget | undefined,
  snapshot: boolean,
): Promise<FeedOutcome> {
  const storeSlug = adapter.storeSlug;
  const warnings: string[] = [];
  const knownIds = await loadKnownIds(client, storeSlug, warnings);

  const startedAt = new Date().toISOString();
  // fetchNewReleases を持つ adapter だけを FEED_ADAPTERS に入れているので必ず在る
  const result = await adapter.fetchNewReleases?.({ ...(knownIds && { knownIds }), snapshot });
  if (result === undefined) {
    return {
      storeSlug,
      status: "error",
      listed: 0,
      sent: 0,
      complete: false,
      pages: 0,
      reason: "新着一覧に対応していない",
      warnings,
    };
  }

  const base: FeedOutcome = {
    storeSlug,
    status: result.status,
    listed: result.listedCount,
    sent: result.works.length,
    complete: result.complete,
    pages: result.pages,
    ...(result.reason === undefined ? {} : { reason: result.reason }),
    warnings: [...warnings, ...result.warnings],
  };
  if (client === undefined) return base;

  // 同じ日に流し直すと上書きされる。ingest 側が冪等なので取り込み結果は変わらない
  const runId = `${startedAt.slice(0, 10)}-${storeSlug}-feed`;
  const payload: IngestPayload = {
    protocolVersion: INGEST_PROTOCOL_VERSION,
    runId,
    storeSlug,
    // 声優を指定しない。crawl_runs の声優が空になり、取り込み側が照合に回る
    startedAt,
    works: result.works,
    ...(result.status === "error" && result.reason !== undefined ? { error: result.reason } : {}),
    // 総件数は送らない。新着一覧の `pager.count` はカテゴリ全体の作品数であって
    // 新着数ではなく、網羅率として記録すると意味を取り違える。
    // 引けなかった入口があったときだけ false を送る。true は送らない
    // (一覧をすべて引けても、新作を取りこぼしていないことの証明にはならない)
    ...(result.complete ? {} : { coverageComplete: false }),
  };

  try {
    const response = await client.ingest(payload);
    return { ...base, saved: response.upserted, dropped: response.skippedByNoTargetActor };
  } catch (error) {
    // 版ずれは走行全体の問題なので、記録を試みず上へ投げる
    if (error instanceof IngestProtocolMismatchError) throw error;
    // 作品を外して error だけ送り直す。これを送らないと crawl_runs に行が残らず、
    // 走行が動かなかったのか新作が無かったのかを後から区別できない
    const reason = error instanceof AdminApiError ? error.message : String(error);
    const recorded = await client
      .ingest(failureReport({ runId, storeSlug, startedAt }, reason))
      .then(() => true)
      .catch(() => false);
    return {
      ...base,
      status: "error",
      reason: recorded ? reason : `${reason} (失敗の記録も送れなかった)`,
    };
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

  const dryRun = values["dry-run"] === true;
  const baseUrl = asString(values["base-url"]) ?? process.env.INGEST_URL;
  const token = process.env.INGEST_TOKEN;
  if (!dryRun && (baseUrl === undefined || baseUrl === "")) {
    process.stderr.write(`--base-url か環境変数 INGEST_URL が要る\n\n${USAGE}`);
    return 1;
  }
  if (!dryRun && (token === undefined || token === "")) {
    process.stderr.write("環境変数 INGEST_TOKEN が要る\n");
    return 1;
  }

  const storeOption = asString(values.store);
  if (storeOption !== undefined && !(STORE_SLUGS as readonly string[]).includes(storeOption)) {
    process.stderr.write(
      `--store は ${STORE_SLUGS.join(" / ")} のどれかを指定する: ${storeOption}\n`,
    );
    return 1;
  }
  const adapters = FEED_ADAPTERS.filter(
    (adapter) => storeOption === undefined || adapter.storeSlug === storeOption,
  );
  if (adapters.length === 0) {
    const names = FEED_ADAPTERS.map((adapter) => adapter.storeSlug).join(" / ");
    process.stderr.write(`新着一覧を持つストアが対象に無い。今あるのは ${names}\n`);
    return 1;
  }

  const client = dryRun ? undefined : new AdminApiClient(baseUrl ?? "", token ?? "");
  const snapshot = values["no-snapshot"] !== true;

  const outcomes: FeedOutcome[] = [];
  let aborted: string | undefined;
  for (const adapter of adapters) {
    try {
      outcomes.push(await runStore(adapter, client, snapshot));
    } catch (error) {
      // 版ずれは 1 ストアの失敗ではなく走行全体の問題。残りを回さず打ち切る
      if (error instanceof IngestProtocolMismatchError) {
        aborted = error.message;
        break;
      }
      const reason = error instanceof AdminApiError ? error.message : String(error);
      outcomes.push({
        storeSlug: adapter.storeSlug,
        status: "error",
        listed: 0,
        sent: 0,
        complete: false,
        pages: 0,
        reason,
        warnings: [],
      });
    }
  }

  for (const outcome of outcomes) {
    process.stdout.write(`${formatOutcome(outcome)}\n`);
    for (const warning of outcome.warnings) {
      process.stderr.write(`[警告] ${STORE_LABELS[outcome.storeSlug]}: ${warning}\n`);
    }
  }

  if (aborted !== undefined) {
    // 打ち切りでも、そこまでの結果は出す。何が取り込まれたかの手がかりになる
    process.stderr.write(
      `\n[中断] サーバーが payload の版の違いを理由に受け取りを拒否した。\n` +
        `  ${aborted}\n` +
        `  クローラーのプロセスが古いコードのまま動いている。止めて起動し直すこと。\n`,
    );
    return 1;
  }

  return outcomes.some((outcome) => outcome.status === "error") ? 1 : 0;
}

function asString(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

// 直接実行されたときだけ動かす (テストから import しても main が走らないようにするため)
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
