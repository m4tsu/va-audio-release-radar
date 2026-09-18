import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { IngestPayload, StoreSlug } from "../src/domain/index.ts";
import { audibleAdapter } from "./adapters/audible.ts";
import { dlsiteAdapter } from "./adapters/dlsite.ts";
import type { AdapterResult, AdapterStatus, SourceAdapter } from "./adapters/types.ts";
import { type ActorSeed, AdminApiClient, AdminApiError } from "./lib/ingest.ts";
import { CRAWLER_DIR } from "./lib/paths.ts";

/**
 * 定期実行の本体 (設計書 §2 / §6)。GitHub Actions の cron からも手元からも同じものを動かす。
 *
 *   INGEST_TOKEN=dev node crawler/run.ts --base-url http://localhost:5199
 *
 * 手順:
 *   1. `crawler/actors.json` を `POST /api/admin/actors` で upsert する (名寄せの材料を先に揃える)
 *   2. 声優 × ストアごとに adapter で取得し、`IngestPayload` を `POST /api/admin/ingest` に送る
 *   3. 集計表を標準出力に出す
 *
 * 取得に失敗しても `error` 付きで必ず送る。crawl_runs に失敗が残らないと、管理画面から
 * 「クローラーが壊れている」ことに気づけないため。失敗があっても全件送り切ってから終了コード 1 にする
 */

const ADAPTERS: Record<StoreSlug, SourceAdapter> = {
  dlsite: dlsiteAdapter,
  audible: audibleAdapter,
};

const ALL_STORES: StoreSlug[] = ["dlsite", "audible"];

const ACTORS_JSON = path.join(CRAWLER_DIR, "actors.json");

const USAGE = `使い方:
  INGEST_TOKEN=... node crawler/run.ts --base-url https://example.workers.dev [オプション]

オプション:
  --base-url <URL>          取り込み先。環境変数 INGEST_URL でも指定できる
  --only <名前,名前>        指定した声優 (canonicalName または slug) だけを対象にする
  --store <dlsite|audible>  片方のストアだけを対象にする
  --limit <N>               先頭 N 人の声優だけを対象にする (動作確認用)
  --dry-run                 取得はするが DB へは送らない (声優の upsert も行わない)
  --no-snapshot             取得した生データを .cache/snapshots に保存しない
  --no-skip-known           既知 ID の詳細取得を飛ばさず、毎回すべて取り直す
`;

const OPTION_SPEC = {
  "base-url": { type: "string" },
  only: { type: "string" },
  store: { type: "string" },
  limit: { type: "string" },
  "dry-run": { type: "boolean" },
  "no-snapshot": { type: "boolean" },
  "no-skip-known": { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

function isStoreSlug(value: string): value is StoreSlug {
  return value === "dlsite" || value === "audible";
}

// --- 集計 ------------------------------------------------------------------

/** 声優 1 人 × ストア 1 つの結果。最後の表と終了コードの材料 */
export type RunOutcome = {
  actor: ActorSeed;
  storeSlug: StoreSlug;
  status: AdapterStatus;
  workCount: number;
  newCount: number;
  unmatchedCount: number;
  /** empty / error の理由、または送信そのものに失敗した理由 */
  reason?: string;
};

export type RunSummary = {
  actors: number;
  ok: number;
  empty: number;
  error: number;
  works: number;
  new: number;
  unmatched: number;
};

export function summarize(outcomes: readonly RunOutcome[]): RunSummary {
  const summary: RunSummary = {
    actors: new Set(outcomes.map((outcome) => outcome.actor.id)).size,
    ok: 0,
    empty: 0,
    error: 0,
    works: 0,
    new: 0,
    unmatched: 0,
  };
  for (const outcome of outcomes) {
    summary[outcome.status] += 1;
    summary.works += outcome.workCount;
    summary.new += outcome.newCount;
    summary.unmatched += outcome.unmatchedCount;
  }
  return summary;
}

/** 声優ごとに 1 行の表。どの声優のどのストアが空・失敗だったかを一目で追えるようにする */
export function formatOutcomeTable(outcomes: readonly RunOutcome[]): string {
  const header = ["声優", "DLsite", "new", "Audible", "new", "備考"];
  const byActor = new Map<string, RunOutcome[]>();
  for (const outcome of outcomes) {
    const list = byActor.get(outcome.actor.id);
    if (list) list.push(outcome);
    else byActor.set(outcome.actor.id, [outcome]);
  }

  const rows = [...byActor.values()].map((group) => {
    const notes = group
      .filter((outcome) => outcome.status !== "ok")
      .map((outcome) => `${outcome.storeSlug}:${outcome.status}`);
    return [
      group[0]?.actor.canonicalName ?? "",
      cell(group, "dlsite", (outcome) => String(outcome.workCount)),
      cell(group, "dlsite", (outcome) => String(outcome.newCount)),
      cell(group, "audible", (outcome) => String(outcome.workCount)),
      cell(group, "audible", (outcome) => String(outcome.newCount)),
      notes.join(" "),
    ];
  });

  return renderTable([header, ...rows]);
}

/** 対象から外したストアは "-" にする。0 件と「そもそも取っていない」を混ぜないため */
function cell(
  group: readonly RunOutcome[],
  storeSlug: StoreSlug,
  pick: (outcome: RunOutcome) => string,
): string {
  const found = group.find((outcome) => outcome.storeSlug === storeSlug);
  return found === undefined ? "-" : pick(found);
}

/**
 * 等幅前提の表。日本語は全角なので表示幅を 2 桁として数える
 * (半角基準で揃えると声優名の列がずれて読みにくい)
 */
function renderTable(rows: readonly (readonly string[])[]): string {
  const columnCount = Math.max(...rows.map((row) => row.length));
  const widths = Array.from({ length: columnCount }, (_, index) =>
    Math.max(...rows.map((row) => displayWidth(row[index] ?? ""))),
  );
  return rows
    .map((row) =>
      row
        .map((value, index) => value + " ".repeat((widths[index] ?? 0) - displayWidth(value)))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

/** 全角と半角を見分ける最小限の判定。ASCII 以外は 2 桁として数える */
function displayWidth(value: string): number {
  let width = 0;
  for (const char of value) width += (char.codePointAt(0) ?? 0) < 0x100 ? 1 : 2;
  return width;
}

// --- シード ----------------------------------------------------------------

export async function loadActorSeeds(file: string = ACTORS_JSON): Promise<ActorSeed[]> {
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${file} が配列ではない`);
  // 中身の検証はサーバー側の zod に任せる。二重に持つと片方だけ古くなるため
  return parsed as ActorSeed[];
}

/** `--only` の値で絞る。canonicalName と slug のどちらでも書けるようにする */
export function filterActors(actors: readonly ActorSeed[], only: string | undefined): ActorSeed[] {
  if (only === undefined) return [...actors];
  const wanted = new Set(
    only
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value !== ""),
  );
  return actors.filter((actor) => wanted.has(actor.canonicalName) || wanted.has(actor.slug));
}

// --- 本体 ------------------------------------------------------------------

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
  if (storeOption !== undefined && !isStoreSlug(storeOption)) {
    process.stderr.write(`--store は dlsite か audible を指定する: ${storeOption}\n`);
    return 1;
  }
  const stores = storeOption === undefined ? ALL_STORES : [storeOption];

  const limitOption = asString(values.limit);
  const limit = limitOption === undefined ? undefined : Number(limitOption);
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    process.stderr.write(`--limit は 1 以上の整数を指定する: ${limitOption}\n`);
    return 1;
  }

  const seeds = await loadActorSeeds();
  let actors = filterActors(seeds, asString(values.only));
  if (limit !== undefined) actors = actors.slice(0, limit);
  if (actors.length === 0) {
    process.stderr.write("対象の声優が 0 人。--only の指定を見直す\n");
    return 1;
  }

  // dry-run では API に触らない。取り込み先がまだ無い状態でも取得部分だけ試せるようにする
  const client = dryRun ? undefined : new AdminApiClient(baseUrl ?? "", token ?? "");

  if (client !== undefined) {
    // --only で絞っていてもシードは全件入れる。名寄せは他の声優の別名まで見て判定するため
    const seeded = await client.upsertActors(seeds);
    process.stdout.write(`声優シードを投入: ${seeded.actors} 人 / alias ${seeded.aliases} 件\n`);
  }

  const knownIds = await loadKnownIds(client, stores, values["no-skip-known"] === true);
  const runDate = new Date().toISOString().slice(0, 10);
  const snapshot = values["no-snapshot"] !== true;

  const outcomes: RunOutcome[] = [];
  let index = 0;
  for (const actor of actors) {
    index += 1;
    const forActor: RunOutcome[] = [];
    for (const storeSlug of stores) {
      const result = await ADAPTERS[storeSlug].fetchByActor(actor.canonicalName, {
        skipKnownIds: knownIds.get(storeSlug),
        snapshot,
      });
      for (const warning of result.warnings) {
        process.stderr.write(`[警告] ${actor.canonicalName} ${storeSlug}: ${warning}\n`);
      }
      forActor.push(await send(client, actor, storeSlug, result, runDate));
    }
    outcomes.push(...forActor);
    process.stdout.write(`${progressLine(index, actors.length, actor, forActor)}\n`);
  }

  process.stdout.write(`\n${formatOutcomeTable(outcomes)}\n`);
  const summary = summarize(outcomes);
  process.stdout.write(
    `\n声優 ${summary.actors} 人 / 取得 ${summary.ok} 成功・${summary.empty} 空・` +
      `${summary.error} 失敗 / 作品 ${summary.works} 件 (new ${summary.new}) / ` +
      `未解決クレジット ${summary.unmatched} 件\n`,
  );

  // 失敗が 1 件でもあれば異常終了。ここまで来ている時点で全件の送信は終えている
  return summary.error > 0 ? 1 : 0;
}

/** 進捗の 1 行。時間のかかる処理なので、声優 1 人が終わるたびに結果が見えるようにする */
function progressLine(
  index: number,
  total: number,
  actor: ActorSeed,
  outcomes: readonly RunOutcome[],
): string {
  const parts = outcomes.map(
    (outcome) =>
      `${outcome.storeSlug} ${outcome.status} ${outcome.workCount}件(new ${outcome.newCount})`,
  );
  const position = String(index).padStart(String(total).length);
  return `[${position}/${total}] ${actor.canonicalName}  ${parts.join("  ")}`;
}

/**
 * 取得結果を ingest に送り、集計 1 行にまとめる。
 * 取得に失敗した (`status: "error"`) ときも `error` 付きで送り、crawl_runs に残す
 */
async function send(
  client: AdminApiClient | undefined,
  actor: ActorSeed,
  storeSlug: StoreSlug,
  result: AdapterResult,
  runDate: string,
): Promise<RunOutcome> {
  const base = {
    actor,
    storeSlug,
    status: result.status,
    workCount: result.works.length,
    newCount: 0,
    unmatchedCount: 0,
    ...(result.reason === undefined ? {} : { reason: result.reason }),
  } satisfies RunOutcome;

  if (client === undefined) return base;

  const payload: IngestPayload = {
    // 同じ日に流し直すと上書きされる。ingest 側が冪等なので取り込み結果は変わらない
    runId: `${runDate}-${storeSlug}-${actor.slug}`,
    storeSlug,
    voiceActorId: actor.id,
    works: result.works,
    ...(result.status === "error" && result.reason !== undefined ? { error: result.reason } : {}),
  };

  try {
    const response = await client.ingest(payload);
    return {
      ...base,
      workCount: response.upserted,
      newCount: response.new,
      unmatchedCount: response.unmatched,
    };
  } catch (error) {
    // 送信できなかったぶんは crawl_runs にも残らないので、集計と終了コードには必ず反映する
    const reason = error instanceof AdminApiError ? error.message : String(error);
    process.stderr.write(`[エラー] ${actor.canonicalName} ${storeSlug}: ${reason}\n`);
    return { ...base, status: "error", reason };
  }
}

/**
 * ストアごとの既知 ID。DLsite の `product.json` を新規 ID だけに絞るために使う。
 * 取れなくても致命的ではない (全件取り直しになるだけ) ので、失敗しても警告に留める
 */
async function loadKnownIds(
  client: AdminApiClient | undefined,
  stores: readonly StoreSlug[],
  disabled: boolean,
): Promise<Map<StoreSlug, ReadonlySet<string>>> {
  const known = new Map<StoreSlug, ReadonlySet<string>>();
  if (client === undefined || disabled) return known;

  for (const storeSlug of stores) {
    try {
      const ids = await client.knownIds(storeSlug);
      known.set(storeSlug, ids);
      process.stdout.write(`既知の ${storeSlug} 作品: ${ids.size} 件 (詳細取得を飛ばす)\n`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[警告] known-ids (${storeSlug}) を取れなかった: ${reason}\n`);
    }
  }
  return known;
}

function asString(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

// 直接実行されたときだけ動かす (テストから import しても main が走らないようにするため)
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
