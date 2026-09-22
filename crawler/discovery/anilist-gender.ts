import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { VoiceActorGender } from "../../src/domain/index.ts";
import { fetchText, rateLimitFor } from "../lib/fetch.ts";
import { writeJsonAtomic } from "../lib/json-file.ts";
import { CACHE_DIR, CRAWLER_DIR } from "../lib/paths.ts";
import {
  type ActorGenderCache,
  type ActorGenderRecord,
  GENDER_JSON,
  type GenderTarget,
  pendingTargets,
  readGenderCache,
} from "./actor-gender.ts";
import { asVoiceActorGender, describeGraphqlErrors } from "./anilist.ts";

/**
 * AniList に staff id で性別だけを問い合わせる (取得だけ。DB には書かない)。
 *
 *   node crawler/discovery/anilist-gender.ts --limit 100
 *
 * 作品から取る経路 (`run.ts` → `anilist.ts`) はシーズンの窓に入った作品の出演者しか通らない。
 * 窓から外れた声優は性別を引く機会が無いままリストに残るので、ここでは対象声優リストと
 * staff 集計にいる「性別が付いていない人」の staff id を直接投げる。
 * 既定で前回の続きから進み、問い合わせ済みの人 (値を持っていなかった人も含む) は引き直さない。
 *
 * 相手の制約 (robots.txt・レート間隔・利用規約) は `docs/stores/anilist.md`。
 * 結果は `crawler/.cache/discovery/anilist-gender.json` に置き、
 * `fill-actor-gender.ts` がそれを読んで対象声優リストに書き入れる
 */

const ENDPOINT = "https://graphql.anilist.co";
const STORE = "anilist";
const DEFAULT_ACTORS_JSON = path.join(CRAWLER_DIR, "actors.generated.json");
const DEFAULT_STAFF_JSON = path.join(CACHE_DIR, "discovery", "anilist-staff.json");

/**
 * 1 リクエストで問い合わせる staff id の数。`Page` の perPage と揃える
 * (返る件数が perPage で頭打ちになるため、揃えないと問い合わせた人が黙って落ちる)
 */
const BATCH_SIZE = 50;
/** 同じ失敗がこれだけ続いたら、相手の状態が変わったとみなして止める */
const CONSECUTIVE_FAILURE_LIMIT = 3;
const FORBIDDEN = 403;
const TOO_MANY_REQUESTS = 429;

/**
 * staff id で性別を引くクエリ。名前も取るのは、id と名前の対応がずれたときに
 * 取得結果から追えるようにするため (`Staff.gender` は自由記述なので、そのままでは検証できない)
 */
export const STAFF_GENDER_QUERY = `query ($ids: [Int]) {
  Page(page: 1, perPage: ${BATCH_SIZE}) {
    staff(id_in: $ids) { id name { native full } gender }
  }
}`;

// --- 応答の解析 (純粋関数) -------------------------------------------------

export type StaffGenderEntry = {
  anilistStaffId: number;
  /** 列挙に写した値。AniList が性別を持たない staff では undefined */
  gender?: VoiceActorGender;
  /** 返ってきた生の文字列 */
  rawGender?: string;
  nativeName?: string;
};

/** `Page.staff` の応答を staff id ごとに引ける形にする。想定外の形は静かに捨てる */
export function parseStaffGenderPage(json: unknown): Map<number, StaffGenderEntry> {
  const page = asRecord(asRecord(asRecord(json)?.data)?.Page);
  const list = Array.isArray(page?.staff) ? page.staff : [];
  const entries = new Map<number, StaffGenderEntry>();
  for (const raw of list) {
    const record = asRecord(raw);
    const anilistStaffId = asNumber(record?.id);
    if (anilistStaffId === undefined) continue;
    const rawGender = asString(record?.gender);
    const gender = asVoiceActorGender(rawGender);
    const nativeName = asString(asRecord(record?.name)?.native);
    entries.set(anilistStaffId, {
      anilistStaffId,
      ...(gender === undefined ? {} : { gender }),
      ...(rawGender === undefined ? {} : { rawGender }),
      ...(nativeName === undefined ? {} : { nativeName }),
    });
  }
  return entries;
}

/**
 * 問い合わせた 1 組を結果の行にする。
 *
 * 応答に居ない staff id は `not-found`。ただし次の 2 つは `failed` にする。
 * 「AniList に居ない」のか「答えが返らなかった」のかを区別できないためで、
 * `failed` は次の実行で引き直せるが `not-found` は引き直さない。
 *
 * - GraphQL エラーが返っている
 * - 1 人も返っていない (200 で `staff` が null / 形が違う応答。id を 50 件投げて 0 件は、
 *   全員が実在しないより応答が壊れていると考えるほうが自然)
 */
export function recordsForBatch(
  targets: readonly GenderTarget[],
  entries: Map<number, StaffGenderEntry>,
  fetchedAt: string,
  graphqlError?: string,
): ActorGenderRecord[] {
  const emptyResponse = entries.size === 0 && targets.length > 0;
  return targets.map((target) => {
    const entry = entries.get(target.anilistStaffId);
    if (entry === undefined) {
      if (graphqlError !== undefined) {
        return {
          ...target,
          status: "failed",
          reason: `GraphQL エラー (${graphqlError})`,
          fetchedAt,
        };
      }
      if (emptyResponse) {
        return { ...target, status: "failed", reason: "応答に staff が 1 件も無い", fetchedAt };
      }
      return {
        ...target,
        status: "not-found",
        reason: "staff id に対応する staff が返らなかった",
        fetchedAt,
      };
    }
    return {
      ...target,
      status: entry.gender === undefined ? "absent" : "ok",
      ...(entry.gender === undefined ? {} : { gender: entry.gender }),
      ...(entry.rawGender === undefined ? {} : { rawGender: entry.rawGender }),
      ...(entry.nativeName === undefined ? {} : { nativeName: entry.nativeName }),
      ...(entry.gender === undefined ? { reason: "AniList が gender を持たない" } : {}),
      fetchedAt,
    };
  });
}

export function summarizeRecords(records: readonly ActorGenderRecord[]): {
  total: number;
  ok: number;
  absent: number;
  notFound: number;
  failed: number;
  byGender: Record<string, number>;
} {
  const byGender: Record<string, number> = {};
  let ok = 0;
  let absent = 0;
  let notFound = 0;
  let failed = 0;
  for (const record of records) {
    if (record.status === "ok") {
      ok += 1;
      const gender = record.gender ?? "unknown";
      byGender[gender] = (byGender[gender] ?? 0) + 1;
      continue;
    }
    if (record.status === "absent") absent += 1;
    else if (record.status === "not-found") notFound += 1;
    else failed += 1;
  }
  return { total: records.length, ok, absent, notFound, failed, byGender };
}

// --- 入力 ------------------------------------------------------------------

/**
 * 性別が付いていない声優を引く相手にする。
 *
 * 対象声優リストと staff 集計の両方を見るのは、片方にしか居ない人が両側に出るため。
 * リストにしか居ない人はシーズンの窓から外れた人、集計にしか居ない人は次の生成で
 * リストに入る人で、後者を落とすと生成を通すために取得をもう一度回すことになる
 */
export function targetsWithoutGender(
  actors: readonly { anilistStaffId?: unknown; canonicalName?: unknown; gender?: unknown }[],
): GenderTarget[] {
  const targets: GenderTarget[] = [];
  for (const actor of actors) {
    const anilistStaffId = actor.anilistStaffId;
    const canonicalName = actor.canonicalName;
    if (typeof anilistStaffId !== "number" || typeof canonicalName !== "string") continue;
    if (actor.gender !== undefined && actor.gender !== "unknown") continue;
    targets.push({ anilistStaffId, canonicalName });
  }
  return targets;
}

/** 対象声優リスト (`crawler/actors.generated.json`)。無ければ空 */
export async function loadActorTargets(filePath: string): Promise<GenderTarget[]> {
  const parsed = await readJsonOrUndefined(filePath);
  if (parsed === undefined) return [];
  if (!Array.isArray(parsed)) throw new Error(`${filePath} が配列ではない`);
  return targetsWithoutGender(parsed as Record<string, unknown>[]);
}

/** staff 集計 (`.cache/discovery/anilist-staff.json`) の `staff[]`。無ければ空 */
export async function loadStaffTargets(filePath: string): Promise<GenderTarget[]> {
  const parsed = await readJsonOrUndefined(filePath);
  if (parsed === undefined) return [];
  const staff = (parsed as { staff?: unknown })?.staff;
  if (!Array.isArray(staff)) throw new Error(`${filePath} に staff 配列が無い`);
  // 集計の鍵は nativeName。`canonicalName` の名前で揃えて記録する
  return targetsWithoutGender(
    (staff as Record<string, unknown>[]).map((record) => ({
      anilistStaffId: record.anilistStaffId,
      canonicalName: record.nativeName,
      gender: record.gender,
    })),
  );
}

async function readJsonOrUndefined(filePath: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return JSON.parse(text);
}

// --- 取得 ------------------------------------------------------------------

/** 呼び出し側に止める理由を返す。403 / 429 と連続失敗は相手の状態が変わった合図 */
export type StopReason = {
  kind: "forbidden" | "rate-limited" | "consecutive-failures";
  detail: string;
};

/** staff id をまとめて 1 回投げる。1 リクエストの失敗はその組の全員を `failed` にする */
export async function fetchGenderBatch(
  targets: readonly GenderTarget[],
  options: { snapshot?: boolean },
): Promise<ActorGenderRecord[]> {
  const ids = targets.map((target) => target.anilistStaffId);
  const result = await fetchText(ENDPOINT, {
    store: STORE,
    requestKey: `staff-gender-${ids[0] ?? 0}-${ids.length}`,
    kind: "json",
    method: "POST",
    body: JSON.stringify({ query: STAFF_GENDER_QUERY, variables: { ids } }),
    contentType: "application/json",
    snapshot: options.snapshot,
  });
  const fetchedAt = new Date().toISOString();

  if (!result.ok) {
    return targets.map((target) => ({
      ...target,
      status: "failed",
      ...(result.status === undefined ? {} : { httpStatus: result.status }),
      reason: result.reason,
      fetchedAt,
    }));
  }

  let json: unknown;
  try {
    json = JSON.parse(result.body);
  } catch (error) {
    return targets.map((target) => ({
      ...target,
      status: "failed",
      httpStatus: result.status,
      reason: `JSON として読めない: ${error instanceof Error ? error.message : String(error)}`,
      fetchedAt,
    }));
  }

  return recordsForBatch(
    targets,
    parseStaffGenderPage(json),
    fetchedAt,
    describeGraphqlErrors(json),
  );
}

/** `targets` を `BATCH_SIZE` ごとに切る */
export function batches(targets: readonly GenderTarget[]): GenderTarget[][] {
  const chunks: GenderTarget[][] = [];
  for (let index = 0; index < targets.length; index += BATCH_SIZE) {
    chunks.push(targets.slice(index, index + BATCH_SIZE));
  }
  return chunks;
}

export async function crawlActorGender(options: {
  targets: readonly GenderTarget[];
  cache: ActorGenderCache;
  outFile: string;
  snapshot?: boolean;
  onProgress?: (done: number, totalToFetch: number) => void;
}): Promise<{ stop?: StopReason }> {
  const { cache } = options;
  let consecutiveFailures = 0;
  let done = 0;

  for (const chunk of batches(options.targets)) {
    // 1 組の例外で走行を落とさない。記録して次の組へ進む
    const records = await fetchGenderBatch(chunk, { snapshot: options.snapshot }).catch(
      (error: unknown) => errorRecords(chunk, error),
    );
    cache.records.push(...records);
    cache.updatedAt = records.at(-1)?.fetchedAt ?? new Date().toISOString();
    await writeJsonAtomic(options.outFile, cache);
    done += records.length;
    options.onProgress?.(done, options.targets.length);

    const failed = records.find((record) => record.status === "failed");
    if (failed === undefined) {
      consecutiveFailures = 0;
      continue;
    }
    // 403 と 429 はこちらの取り方を相手が拒んでいる合図なので、その場で止めて人が判断する
    if (failed.httpStatus === FORBIDDEN) {
      return { stop: { kind: "forbidden", detail: `${failed.canonicalName}: ${failed.reason}` } };
    }
    if (failed.httpStatus === TOO_MANY_REQUESTS) {
      return {
        stop: { kind: "rate-limited", detail: `${failed.canonicalName}: ${failed.reason}` },
      };
    }
    consecutiveFailures += 1;
    if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
      return {
        stop: {
          kind: "consecutive-failures",
          detail: `${consecutiveFailures} 組続けて失敗 (最後: ${failed.canonicalName} ${failed.reason})`,
        },
      };
    }
  }

  return {};
}

/** 取得の途中で投げた例外を、失敗した組として残す (1 組の例外で走行全体を落とさないため) */
function errorRecords(targets: readonly GenderTarget[], error: unknown): ActorGenderRecord[] {
  const fetchedAt = new Date().toISOString();
  return targets.map((target) => ({
    ...target,
    status: "failed",
    reason: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    fetchedAt,
  }));
}

// --- CLI -------------------------------------------------------------------

const USAGE = `使い方:
  node crawler/discovery/anilist-gender.ts [オプション]

オプション:
  --actors <path>  対象声優リスト (既定 crawler/actors.generated.json)
  --staff <path>   staff 集計 (既定 crawler/.cache/discovery/anilist-staff.json)
  --out <path>     結果の置き場所 (既定 crawler/.cache/discovery/anilist-gender.json)
  --limit <N>      この人数だけ引いて終わる (既定: 残り全員)
  --restart        前回の結果を捨てて最初から引き直す (既定は続きから)
  --snapshot       応答 JSON を .cache/snapshots に残す
`;

const OPTION_SPEC = {
  actors: { type: "string" },
  staff: { type: "string" },
  out: { type: "string" },
  limit: { type: "string" },
  restart: { type: "boolean" },
  snapshot: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  return `${Math.floor(totalMinutes / 60)} 時間 ${totalMinutes % 60} 分`;
}

/** 進捗の見込み。間隔は `rateLimitFor()` が持つので、そこから読む */
function estimatedMs(targetCount: number): number {
  return Math.ceil(targetCount / BATCH_SIZE) * rateLimitFor(ENDPOINT).intervalMs;
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

  const actorsFile = asStringOption(values.actors) ?? DEFAULT_ACTORS_JSON;
  const staffFile = asStringOption(values.staff) ?? DEFAULT_STAFF_JSON;
  const outFile = asStringOption(values.out) ?? GENDER_JSON;
  const limitOption = asStringOption(values.limit);
  const limit = limitOption === undefined ? undefined : Number(limitOption);
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    process.stderr.write(`--limit は 1 以上の整数を指定する: ${limitOption}\n`);
    return 1;
  }
  const snapshot = values.snapshot === true;
  const startedAt = Date.now();

  const [actorTargets, staffTargets] = await Promise.all([
    loadActorTargets(actorsFile),
    loadStaffTargets(staffFile),
  ]);
  const targets = [...actorTargets, ...staffTargets];
  process.stdout.write(
    `性別が付いていない声優: リスト ${actorTargets.length} 人 (${actorsFile}) / ` +
      `staff 集計 ${staffTargets.length} 人 (${staffFile})\n`,
  );

  const existing = values.restart === true ? undefined : await readGenderCache(outFile);
  const cache: ActorGenderCache = existing ?? {
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    records: [],
  };
  if (existing !== undefined) {
    // 失敗した人は毎回引き直す。答えを受け取れていない人を「問い合わせ済み」として残すと、
    // 再開したつもりでその人たちだけ永久に引かれないままになる
    const before = cache.records.length;
    cache.records = cache.records.filter((record) => record.status !== "failed");
    const retried = before - cache.records.length;
    if (retried > 0) process.stdout.write(`  前回失敗した ${retried} 人を引き直す\n`);
    process.stdout.write(`  続きから: 問い合わせ済み ${cache.records.length} 人を飛ばす\n`);
  }

  const pending = pendingTargets(targets, cache.records, limit);
  process.stdout.write(
    `これから引く: ${pending.length} 人 / ${Math.ceil(pending.length / BATCH_SIZE)} リクエスト ` +
      `(最短 ${formatDuration(estimatedMs(pending.length))})\n`,
  );

  const { stop } = await crawlActorGender({
    targets: pending,
    cache,
    outFile,
    snapshot,
    // 1 リクエストで 50 人ぶん進むので、組ごとに 1 行出しても流れ続けはしない
    onProgress: (done, totalToFetch) => {
      const summary = summarizeRecords(cache.records);
      process.stdout.write(
        `[${done}/${totalToFetch}] 性別あり ${summary.ok} / 値なし ${summary.absent} / ` +
          `staff なし ${summary.notFound} / 失敗 ${summary.failed}\n`,
      );
    },
  });

  const summary = summarizeRecords(cache.records);
  process.stdout.write("\n");
  process.stdout.write(`結果: ${outFile}\n`);
  process.stdout.write(`  問い合わせ済み: ${summary.total} 人\n`);
  process.stdout.write(`  性別が取れた: ${summary.ok} ${JSON.stringify(summary.byGender)}\n`);
  process.stdout.write(`  AniList が値を持たない: ${summary.absent}\n`);
  process.stdout.write(`  staff が返らない: ${summary.notFound}\n`);
  process.stdout.write(`  取得に失敗: ${summary.failed}\n`);
  process.stdout.write(`  所要: ${formatDuration(Date.now() - startedAt)}\n`);

  if (stop !== undefined) {
    process.stderr.write(`\n中断しました (${stop.kind}): ${stop.detail}\n`);
    process.stderr.write("もう一度実行すると続きから再開できます\n");
    return 1;
  }
  return 0;
}

// --- 小物 ------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asStringOption(value: string | boolean | undefined): string | undefined {
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
