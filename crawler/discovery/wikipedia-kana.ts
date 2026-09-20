import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { type FetchFailure, fetchText } from "../lib/fetch.ts";
import { CACHE_DIR, CRAWLER_DIR } from "../lib/paths.ts";
import {
  articleTitles,
  articleUrl,
  describeKanaRejection,
  type KanaRejection,
  kanaFromArticle,
  parseArticle,
} from "./wikipedia-article.ts";

/**
 * 日本語版 Wikipedia から対象声優のかなを取る (取得だけ。DB には書かない)。
 *
 *   node crawler/discovery/wikipedia-kana.ts --limit 20
 *
 * 1 人につき `/wiki/<名前>` を引き、取れなければ `/wiki/<名前>_(声優)` で引き直す。
 * 5 秒間隔なので全員だと数時間かかる。既定で前回の続きから進み、取得済みの人は引き直さない。
 * 取れなかった人はかな無しのまま次へ進む。
 *
 * サイトの制約 (robots.txt・UA・使ってよい URL) は `docs/stores/wikimedia.md`、
 * 取ってよい記事の条件は `docs/research/actor-kana-sources-2026-09-20.md`。
 * 結果は `crawler/.cache/discovery/wikipedia-kana.json` に置き、
 * `build-actors.ts` がそれを読んで対象声優リストに入れる
 */

const STORE = "wikimedia";
const DISCOVERY_DIR = path.join(CACHE_DIR, "discovery");
export const KANA_JSON = path.join(DISCOVERY_DIR, "wikipedia-kana.json");
const DEFAULT_ACTORS_JSON = path.join(CRAWLER_DIR, "actors.generated.json");

/** 何人ごとに進捗を出すか */
const PROGRESS_EVERY = 20;
/** 同じ失敗がこれだけ続いたら、相手の状態が変わったとみなして止める */
const CONSECUTIVE_FAILURE_LIMIT = 10;
const NOT_FOUND = 404;
const FORBIDDEN = 403;
const TOO_MANY_REQUESTS = 429;
/** 進捗の見込みに使う 1 人あたりの秒数。rateLimitFor() の未知ホストの既定値と同じ */
const ESTIMATED_MS_PER_ACTOR = 5_000;

// --- 結果 ------------------------------------------------------------------

/**
 * 1 人ぶんの結果。取れなかった人も理由付きで残す。
 * 「引いたが取れなかった」と「まだ引いていない」を区別できないと、再開のたびに引き直してしまう
 */
export type WikipediaKanaRecord = {
  canonicalName: string;
  /** ok=かなが取れた / rejected=記事はあるが条件を満たさない / not-found=記事が無い / failed=取得に失敗 */
  status: "ok" | "rejected" | "not-found" | "failed";
  /** 保存する形のかな (空白なしのひらがな) */
  kana?: string;
  /** 記事に書かれていたままの値。取り違えを後から追えるようにする */
  rawKana?: string;
  source?: "furigana" | "kana-name";
  /** かなを取った、または最後に引いた記事名 */
  title?: string;
  /** 着地した記事名。転送されたかどうかが後から分かる */
  pageName?: string;
  reason?: string;
  /** HTTP ステータス。ネットワークエラーでは undefined */
  httpStatus?: number;
  fetchedAt: string;
};

export type WikipediaKanaCache = {
  startedAt: string;
  updatedAt: string;
  records: WikipediaKanaRecord[];
};

/** 取得済みのかな (canonicalName → かな)。`build-actors.ts` が対象声優リストに入れる */
export function kanaByCanonicalName(
  records: readonly WikipediaKanaRecord[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const record of records) {
    if (record.status === "ok" && record.kana !== undefined)
      map[record.canonicalName] = record.kana;
  }
  return map;
}

export function summarizeRecords(records: readonly WikipediaKanaRecord[]): {
  total: number;
  ok: number;
  rejected: number;
  notFound: number;
  failed: number;
  bySource: Record<string, number>;
  byReason: Record<string, number>;
} {
  const bySource: Record<string, number> = {};
  const byReason: Record<string, number> = {};
  let ok = 0;
  let rejected = 0;
  let notFound = 0;
  let failed = 0;
  for (const record of records) {
    if (record.status === "ok") {
      ok += 1;
      const source = record.source ?? "unknown";
      bySource[source] = (bySource[source] ?? 0) + 1;
      continue;
    }
    if (record.status === "rejected") rejected += 1;
    else if (record.status === "not-found") notFound += 1;
    else failed += 1;
    const reason = record.reason ?? "unknown";
    byReason[reason] = (byReason[reason] ?? 0) + 1;
  }
  return { total: records.length, ok, rejected, notFound, failed, bySource, byReason };
}

// --- 入出力 ----------------------------------------------------------------

/**
 * 一時ファイルに書いてから rename する。数時間のバッチの途中で中断されても
 * JSON が壊れていないことを保証するため (壊れると再開できず全部やり直しになる)
 */
async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}

/** 取得結果が無くても生成は動く (かな無しになるだけ) ので、無ければ空として扱う */
export async function readKanaCache(
  filePath: string = KANA_JSON,
): Promise<WikipediaKanaCache | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as WikipediaKanaCache;
  } catch {
    return undefined;
  }
}

/** 対象声優リストから、引く相手の名前だけ取る */
export async function loadCanonicalNames(filePath: string): Promise<string[]> {
  const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${filePath} が配列ではない`);
  return (parsed as { canonicalName?: unknown }[])
    .map((actor) => actor.canonicalName)
    .filter((name): name is string => typeof name === "string" && name !== "");
}

// --- 取得 ------------------------------------------------------------------

/** 呼び出し側に止める理由を返す。403 / 429 と連続失敗は相手の状態が変わった合図 */
export type StopReason = {
  kind: "forbidden" | "rate-limited" | "consecutive-failures";
  detail: string;
};

/**
 * 1 人ぶん。`<名前>` で取れなければ `<名前>_(声優)` を引く。
 * 引き直すのは「記事が無い」ときと「記事はあるが条件を満たさない」ときの両方で、
 * 曖昧さ回避のページに当たった人の本人記事がそちらにあるため
 */
export async function fetchActorKana(
  canonicalName: string,
  options: { snapshot?: boolean },
): Promise<WikipediaKanaRecord> {
  let lastFailure: FetchFailure | undefined;
  let lastRejection: { title: string; pageName?: string; reason: KanaRejection } | undefined;

  for (const title of articleTitles(canonicalName)) {
    const result = await fetchText(articleUrl(title), {
      store: STORE,
      requestKey: title,
      kind: "html",
      snapshot: options.snapshot,
    });
    const fetchedAt = new Date().toISOString();

    if (!result.ok) {
      // 404 は「その記事名が無い」だけなので、次の記事名を試す
      if (result.status !== NOT_FOUND)
        return failureRecord(canonicalName, title, result, fetchedAt);
      lastFailure = result;
      continue;
    }

    const article = parseArticle(result.body);
    const outcome = kanaFromArticle({ requestedTitle: title, canonicalName, article });
    if ("kana" in outcome) {
      return {
        canonicalName,
        status: "ok",
        kana: outcome.kana,
        rawKana: outcome.raw,
        source: outcome.source,
        title,
        ...(article.pageName === undefined ? {} : { pageName: article.pageName }),
        httpStatus: result.status,
        fetchedAt,
      };
    }
    lastRejection = {
      title,
      ...(article.pageName === undefined ? {} : { pageName: article.pageName }),
      reason: outcome.rejected,
    };
  }

  const fetchedAt = new Date().toISOString();
  if (lastRejection !== undefined) {
    return {
      canonicalName,
      status: "rejected",
      title: lastRejection.title,
      ...(lastRejection.pageName === undefined ? {} : { pageName: lastRejection.pageName }),
      reason: describeKanaRejection(lastRejection.reason),
      fetchedAt,
    };
  }
  return {
    canonicalName,
    status: "not-found",
    reason: `記事が無い (${lastFailure?.reason ?? "HTTP 404"})`,
    httpStatus: NOT_FOUND,
    fetchedAt,
  };
}

function failureRecord(
  canonicalName: string,
  title: string,
  result: FetchFailure,
  fetchedAt: string,
): WikipediaKanaRecord {
  return {
    canonicalName,
    status: "failed",
    title,
    ...(result.status === undefined ? {} : { httpStatus: result.status }),
    reason: result.reason,
    fetchedAt,
  };
}

export async function crawlActorKana(options: {
  canonicalNames: readonly string[];
  cache: WikipediaKanaCache;
  outFile: string;
  snapshot?: boolean;
  onProgress?: (done: number, totalToFetch: number) => void;
}): Promise<{ stop?: StopReason }> {
  const { cache } = options;
  let consecutiveFailures = 0;
  let done = 0;

  for (const canonicalName of options.canonicalNames) {
    const record = await fetchActorKana(canonicalName, { snapshot: options.snapshot });
    cache.records.push(record);
    cache.updatedAt = record.fetchedAt;
    await writeJsonAtomic(options.outFile, cache);
    done += 1;
    options.onProgress?.(done, options.canonicalNames.length);

    if (record.status !== "failed") {
      consecutiveFailures = 0;
      continue;
    }
    // 403 と 429 はこちらの取り方を相手が拒んでいる合図なので、その場で止めて人が判断する
    if (record.httpStatus === FORBIDDEN) {
      return { stop: { kind: "forbidden", detail: `${canonicalName}: ${record.reason}` } };
    }
    if (record.httpStatus === TOO_MANY_REQUESTS) {
      return { stop: { kind: "rate-limited", detail: `${canonicalName}: ${record.reason}` } };
    }
    consecutiveFailures += 1;
    if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
      return {
        stop: {
          kind: "consecutive-failures",
          detail: `${consecutiveFailures} 人続けて失敗 (最後: ${canonicalName} ${record.reason})`,
        },
      };
    }
  }

  return {};
}

// --- CLI -------------------------------------------------------------------

const USAGE = `使い方:
  node crawler/discovery/wikipedia-kana.ts [オプション]

オプション:
  --actors <path>  対象声優リスト (既定 crawler/actors.generated.json)
  --out <path>     結果の置き場所 (既定 crawler/.cache/discovery/wikipedia-kana.json)
  --limit <N>      この人数だけ引いて終わる (既定: 残り全員)
  --restart        前回の結果を捨てて最初から引き直す (既定は続きから)
  --retry-failed   前回 failed だった人を引き直す (記事が無い人・条件を満たさない人は引き直さない)
  --snapshot       記事 HTML を .cache/snapshots に残す (1 件 1MB 超)
`;

const OPTION_SPEC = {
  actors: { type: "string" },
  out: { type: "string" },
  limit: { type: "string" },
  restart: { type: "boolean" },
  "retry-failed": { type: "boolean" },
  snapshot: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  return `${Math.floor(totalMinutes / 60)} 時間 ${totalMinutes % 60} 分`;
}

export async function main(argv: readonly string[]): Promise<number> {
  let values: Record<string, string | boolean | undefined>;
  try {
    values = parseArgs({ args: [...argv], options: OPTION_SPEC, allowPositionals: false }).values;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 1;
  }
  if (values.help === true) {
    process.stdout.write(USAGE);
    return 0;
  }

  const actorsFile = asString(values.actors) ?? DEFAULT_ACTORS_JSON;
  const outFile = asString(values.out) ?? KANA_JSON;
  const limitOption = asString(values.limit);
  const limit = limitOption === undefined ? undefined : Number(limitOption);
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    process.stderr.write(`--limit は 1 以上の整数を指定する: ${limitOption}\n`);
    return 1;
  }
  // 既定はスナップショット無し。記事 1 件が 1MB 超あり、全員ぶん残すと数 GB になる。
  // 判定に使った事実は結果の JSON に残るので、再現性はそちらで担保する
  const snapshot = values.snapshot === true;
  const startedAt = Date.now();

  const canonicalNames = await loadCanonicalNames(actorsFile);
  process.stdout.write(`対象声優: ${canonicalNames.length} 人 (${actorsFile})\n`);

  const existing = values.restart === true ? undefined : await readKanaCache(outFile);
  const cache: WikipediaKanaCache = existing ?? {
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    records: [],
  };
  if (existing !== undefined) {
    if (values["retry-failed"] === true) {
      const before = cache.records.length;
      cache.records = cache.records.filter((record) => record.status !== "failed");
      process.stdout.write(`  前回の失敗 ${before - cache.records.length} 人を引き直す\n`);
    }
    process.stdout.write(`  続きから: 取得済み ${cache.records.length} 人を飛ばす\n`);
  }

  const doneNames = new Set(cache.records.map((record) => record.canonicalName));
  let pending = canonicalNames.filter((name) => !doneNames.has(name));
  if (limit !== undefined) pending = pending.slice(0, limit);

  process.stdout.write(
    `これから引く: ${pending.length} 人 (見込み ${formatDuration(pending.length * ESTIMATED_MS_PER_ACTOR)})\n`,
  );

  const { stop } = await crawlActorKana({
    canonicalNames: pending,
    cache,
    outFile,
    snapshot,
    onProgress: (done, totalToFetch) => {
      if (done % PROGRESS_EVERY !== 0 && done !== totalToFetch) return;
      const summary = summarizeRecords(cache.records);
      const elapsed = Date.now() - startedAt;
      const remaining = ((totalToFetch - done) * elapsed) / Math.max(done, 1);
      process.stdout.write(
        `[${done}/${totalToFetch}] 累計 ${summary.total}/${canonicalNames.length} ` +
          `かな ${summary.ok} / 条件外 ${summary.rejected} / 記事なし ${summary.notFound} / ` +
          `失敗 ${summary.failed} (経過 ${formatDuration(elapsed)} / 残り ${formatDuration(remaining)})\n`,
      );
    },
  });

  const summary = summarizeRecords(cache.records);
  process.stdout.write("\n");
  process.stdout.write(`結果: ${outFile}\n`);
  process.stdout.write(`  対象 ${canonicalNames.length} 人中 ${summary.total} 人を処理\n`);
  process.stdout.write(`  かなが取れた: ${summary.ok} ${JSON.stringify(summary.bySource)}\n`);
  process.stdout.write(`  条件を満たさない: ${summary.rejected}\n`);
  process.stdout.write(`  記事が無い: ${summary.notFound}\n`);
  process.stdout.write(`  取得に失敗: ${summary.failed}\n`);
  process.stdout.write(`  理由の内訳: ${JSON.stringify(summary.byReason)}\n`);
  process.stdout.write(`  所要: ${formatDuration(Date.now() - startedAt)}\n`);

  if (stop !== undefined) {
    process.stderr.write(`\n中断しました (${stop.kind}): ${stop.detail}\n`);
    process.stderr.write("もう一度実行すると続きから再開できます\n");
    return 1;
  }
  return 0;
}

function asString(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

// 直接実行されたときだけ動かす。テストから import しても走らないようにするため
const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
