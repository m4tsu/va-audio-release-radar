import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { type FetchResult, fetchText, rateLimitFor } from "../lib/fetch.ts";
import { writeJsonAtomic } from "../lib/json-file.ts";
import {
  type ActorKanaCache,
  type ActorKanaRecord,
  KANA_JSON,
  readKanaCache,
} from "./actor-kana.ts";
import { toStoredKana } from "./kana-text.ts";
import { entityUrl, isEntityId, kanaClaims } from "./wikidata-entity.ts";
import {
  articleUrl,
  describeKanaRejection,
  kanaFromArticle,
  parseArticle,
} from "./wikipedia-article.ts";
import { type StopReason, stopReasonFor } from "./wikipedia-kana.ts";

/**
 * 「記事には辿り着いたが読みが書かれていなかった」人だけを引き直し、
 * 記事の導入部と Wikidata から読みを埋める (取得だけ。DB には書かない)。
 *
 *   node crawler/discovery/wikipedia-kana-refill.ts --limit 5
 *
 * この人たちは `kanaFromArticle` の 3 条件 (記事名が一致する / 曖昧さ回避でない /
 * 声優のカテゴリを持つ) を通っており、**記事が本人のものであることが確認済み**で、
 * 足りないのは読みだけ。他の理由で落ちた人は、記事が本人のものかを機械で確かめられないので引かない。
 *
 * 結果は `wikipedia-kana.ts` と同じ `crawler/.cache/discovery/wikipedia-kana.json` の
 * 同じ人の行を書き換える。読みが取れなかった人の理由は「読みが書かれていない」と別の文字列にするので、
 * もう一度実行しても同じ人を引き直さない。
 *
 * サイトの制約 (robots.txt・UA・使ってよい URL) は `docs/stores/wikimedia.md`
 */

const STORE = "wikimedia";
/** 何人ごとに進捗を出すか */
const PROGRESS_EVERY = 10;

/** 引き直す対象。`wikipedia-kana.ts` がこの理由で残した人だけを引く */
export const NO_KANA_REASON = describeKanaRejection("no-kana");
/** 引き直しても読みが無かった人。対象の理由と別の文字列にして、次の実行で引き直さない */
export const REFILLED_NO_KANA_REASON = "読みが記事にも Wikidata にも無い";
/** 導入部に読みが無く、Wikidata へ辿る項目 id も記事に無い人。項目 id が無ければ項目は引けない */
export const NO_ENTITY_REASON = "読みが記事に無く、Wikidata の項目 id も記事に無い";

/**
 * 進捗の見込みに使う 1 人あたりの時間。間隔は `rateLimitFor()` が持つので、そこから読む。
 * 導入部で取れなかった人は Wikidata も引くので、実際はこの見込みより長くかかる
 */
function estimatedMsPerActor(): number {
  return rateLimitFor(articleUrl("上田麗奈")).intervalMs;
}

// --- 対象の選び方 ----------------------------------------------------------

/**
 * 引き直す人を、結果に並んでいる順に返す。`limit` を渡すとその人数で切る。
 *
 * 記事名を持たない行は引かない。どの記事で 3 条件を満たしたのかが分からず、
 * 名前から引き直すと本人の記事とは限らなくなる
 */
export function refillTargets(
  records: readonly ActorKanaRecord[],
  limit?: number,
): ActorKanaRecord[] {
  const targets = records.filter(
    (record) =>
      record.status === "rejected" &&
      record.reason === NO_KANA_REASON &&
      record.title !== undefined,
  );
  return limit === undefined ? targets : targets.slice(0, limit);
}

/** 同じ人の行を置き換える。行が見つからないのは呼び出し側の取り違えなので投げる */
export function replaceRecord(cache: ActorKanaCache, record: ActorKanaRecord): void {
  const index = cache.records.findIndex((item) => item.canonicalName === record.canonicalName);
  if (index < 0) throw new Error(`${record.canonicalName} の行が結果に無い`);
  cache.records[index] = record;
  cache.updatedAt = record.fetchedAt;
}

// --- 取得 ------------------------------------------------------------------

function failureRecord(
  base: ActorKanaRecord,
  result: Extract<FetchResult, { ok: false }>,
  reason: string,
): ActorKanaRecord {
  // 残すのは失敗した取得のステータスだけ。記事が 200 でも項目で失敗したなら 200 を残さない
  const { httpStatus: _replaced, ...rest } = base;
  return {
    ...rest,
    status: "failed",
    ...(result.status === undefined ? {} : { httpStatus: result.status }),
    reason,
  };
}

/**
 * 1 人ぶん。記事を引き直し、導入部 → Wikidata の順に読みを探す。
 *
 * 記事はもう一度 3 条件で確かめる。前回引いてから転送やカテゴリが変わっていることがあり、
 * 確かめ直さずに読みだけ取ると、本人のものでない記事から取ることになる
 */
export async function refillActorKana(
  target: ActorKanaRecord,
  options: { snapshot?: boolean },
): Promise<ActorKanaRecord> {
  const { canonicalName } = target;
  const title = target.title;
  if (title === undefined) {
    return {
      canonicalName,
      status: "failed",
      reason: "引き直す記事名が結果に無い",
      fetchedAt: new Date().toISOString(),
    };
  }

  const article = await fetchText(articleUrl(title), {
    store: STORE,
    requestKey: title,
    kind: "html",
    snapshot: options.snapshot,
  });
  if (!article.ok) {
    return failureRecord(
      { canonicalName, status: "failed", title, fetchedAt: new Date().toISOString() },
      article,
      `記事を引き直せない (${article.reason})`,
    );
  }

  const parsed = parseArticle(article.body);
  const base: ActorKanaRecord = {
    canonicalName,
    status: "rejected",
    title,
    ...(parsed.pageName === undefined ? {} : { pageName: parsed.pageName }),
    ...(parsed.wikibaseItemId === undefined ? {} : { wikibaseItemId: parsed.wikibaseItemId }),
    httpStatus: article.status,
    fetchedAt: new Date().toISOString(),
  };

  const outcome = kanaFromArticle({ requestedTitle: title, canonicalName, article: parsed });
  if ("kana" in outcome) {
    return {
      ...base,
      status: "ok",
      kana: outcome.kana,
      rawKana: outcome.raw,
      source: outcome.source,
    };
  }
  if (outcome.rejected !== "no-kana") {
    return { ...base, reason: describeKanaRejection(outcome.rejected) };
  }

  if (parsed.leadReading !== undefined) {
    const kana = toStoredKana(parsed.leadReading);
    if (kana !== undefined) {
      return { ...base, status: "ok", kana, rawKana: parsed.leadReading, source: "lead" };
    }
  }

  const itemId = parsed.wikibaseItemId;
  // 名前から項目を引く経路は robots.txt で塞がれている。記事に id が無ければそこで終わり
  if (itemId === undefined || !isEntityId(itemId)) {
    return { ...base, reason: NO_ENTITY_REASON };
  }

  const entity = await fetchText(entityUrl(itemId), {
    store: STORE,
    requestKey: itemId,
    kind: "html",
    snapshot: options.snapshot,
  });
  if (!entity.ok) {
    return failureRecord(
      { ...base, status: "failed", fetchedAt: new Date().toISOString() },
      entity,
      `Wikidata の項目を引けない (${entity.reason})`,
    );
  }

  const fetchedAt = new Date().toISOString();
  for (const claim of kanaClaims(entity.body)) {
    const kana = toStoredKana(claim);
    if (kana !== undefined) {
      return { ...base, status: "ok", kana, rawKana: claim, source: "wikidata", fetchedAt };
    }
  }
  return { ...base, reason: REFILLED_NO_KANA_REASON, fetchedAt };
}

/** 取得でも解析でもない例外 (ディスク書き込みなど) を、失敗した 1 人として残す */
function errorRecord(target: ActorKanaRecord, error: unknown): ActorKanaRecord {
  return {
    canonicalName: target.canonicalName,
    status: "failed",
    ...(target.title === undefined ? {} : { title: target.title }),
    reason: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    fetchedAt: new Date().toISOString(),
  };
}

export async function refillActorKanaAll(options: {
  targets: readonly ActorKanaRecord[];
  cache: ActorKanaCache;
  outFile: string;
  snapshot?: boolean;
  onProgress?: (done: readonly ActorKanaRecord[], total: number) => void;
}): Promise<{ stop?: StopReason; done: ActorKanaRecord[] }> {
  const done: ActorKanaRecord[] = [];
  let consecutiveFailures = 0;

  for (const target of options.targets) {
    // 1 人の例外で走行を落とさない。記録して次の人へ進む
    const record = await refillActorKana(target, { snapshot: options.snapshot }).catch(
      (error: unknown) => errorRecord(target, error),
    );
    replaceRecord(options.cache, record);
    await writeJsonAtomic(options.outFile, options.cache);
    done.push(record);
    options.onProgress?.(done, options.targets.length);

    consecutiveFailures = record.status === "failed" ? consecutiveFailures + 1 : 0;
    const stop = stopReasonFor(record, consecutiveFailures);
    if (stop !== undefined) return { stop, done };
  }
  return { done };
}

// --- 結果 ------------------------------------------------------------------

export function summarizeRefill(records: readonly ActorKanaRecord[]): {
  total: number;
  ok: number;
  bySource: Record<string, number>;
  byReason: Record<string, number>;
} {
  const bySource: Record<string, number> = {};
  const byReason: Record<string, number> = {};
  let ok = 0;
  for (const record of records) {
    if (record.status === "ok") {
      ok += 1;
      const source = record.source ?? "unknown";
      bySource[source] = (bySource[source] ?? 0) + 1;
      continue;
    }
    const reason = record.reason ?? "unknown";
    byReason[reason] = (byReason[reason] ?? 0) + 1;
  }
  return { total: records.length, ok, bySource, byReason };
}

// --- CLI -------------------------------------------------------------------

const USAGE = `使い方:
  node crawler/discovery/wikipedia-kana-refill.ts [オプション]

前回の取得で「読みが書かれていない」で終わった人だけを引き直し、
記事の導入部と Wikidata の P1814 から読みを埋める。結果は同じファイルの同じ行を書き換える。

オプション:
  --kana <path>    かなの取得結果 (既定 crawler/.cache/discovery/wikipedia-kana.json)
  --limit <N>      この人数だけ引いて終わる (既定: 対象全員)
  --snapshot       取った HTML を .cache/snapshots に残す (1 件 1MB 超)
`;

const OPTION_SPEC = {
  kana: { type: "string" },
  limit: { type: "string" },
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

  const kanaFile = asString(values.kana) ?? KANA_JSON;
  const limitOption = asString(values.limit);
  const limit = limitOption === undefined ? undefined : Number(limitOption);
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    process.stderr.write(`--limit は 1 以上の整数を指定する: ${limitOption}\n`);
    return 1;
  }
  const snapshot = values.snapshot === true;
  const startedAt = Date.now();

  const cache = await readKanaCache(kanaFile);
  if (cache === undefined) {
    process.stderr.write(
      `${kanaFile} が無い。先に node crawler/discovery/wikipedia-kana.ts で取得する\n`,
    );
    return 1;
  }

  const targets = refillTargets(cache.records, limit);
  process.stdout.write(`結果: ${kanaFile} (${cache.records.length} 人)\n`);
  process.stdout.write(
    `「${NO_KANA_REASON}」で残っている人: ${refillTargets(cache.records).length} 人\n`,
  );
  process.stdout.write(
    `これから引き直す: ${targets.length} 人 (最短 ${formatDuration(targets.length * estimatedMsPerActor())})\n`,
  );
  if (targets.length === 0) return 0;

  const { stop, done } = await refillActorKanaAll({
    targets,
    cache,
    outFile: kanaFile,
    snapshot,
    onProgress: (records, total) => {
      const count = records.length;
      if (count % PROGRESS_EVERY !== 0 && count !== total) return;
      const summary = summarizeRefill(records);
      const elapsed = Date.now() - startedAt;
      const remaining = ((total - count) * elapsed) / Math.max(count, 1);
      process.stdout.write(
        `[${count}/${total}] かな ${summary.ok} ${JSON.stringify(summary.bySource)} ` +
          `(経過 ${formatDuration(elapsed)} / 残り ${formatDuration(remaining)})\n`,
      );
    },
  });

  const summary = summarizeRefill(done);
  process.stdout.write("\n");
  process.stdout.write(`引き直した: ${summary.total} 人\n`);
  process.stdout.write(`  かなが取れた: ${summary.ok} ${JSON.stringify(summary.bySource)}\n`);
  process.stdout.write(`  取れなかった: ${summary.total - summary.ok}\n`);
  process.stdout.write(`  理由の内訳: ${JSON.stringify(summary.byReason)}\n`);
  process.stdout.write(`  所要: ${formatDuration(Date.now() - startedAt)}\n`);

  if (stop !== undefined) {
    process.stderr.write(`\n中断しました (${stop.kind}): ${stop.detail}\n`);
    process.stderr.write("もう一度実行すると残りから再開できます\n");
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
