import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { type RawWork, STORE_SLUGS, type StoreSlug } from "../src/domain/index.ts";
import { audibleAdapter } from "./adapters/audible.ts";
import { dlsiteAdapter } from "./adapters/dlsite.ts";
import { pokedoraAdapter } from "./adapters/pokedora.ts";
import type { ActorQuery, AdapterResult, Coverage, SourceAdapter } from "./adapters/types.ts";
import { loadPokedoraDirectory, lookupActor } from "./discovery/pokedora-directory.ts";
import { type ActorSeed, spacedVerifiedAliasNames } from "./lib/ingest.ts";
import { LAST_RESULT_DIR, safeFileName } from "./lib/paths.ts";
import { loadActorSeeds } from "./run.ts";

/**
 * 調査用 CLI。
 *
 *   node crawler/cli.ts actor "上田麗奈"
 *   node crawler/cli.ts diff  "上田麗奈"
 *
 * オプション:
 *   --store <slug>           1 つのストアだけ実行する (dlsite / audible / pokedora)
 *   --json                   RawWork[] をそのまま標準出力に出す
 *   --no-snapshot            crawler/.cache/snapshots への保存を止める
 *   --skip-known RJ1,RJ2     既知 ID の詳細取得を飛ばす (将来 DB から渡す)
 *
 * 依存は増やさず node:util の parseArgs で引数を読む
 */

const ADAPTERS: Record<StoreSlug, SourceAdapter> = {
  dlsite: dlsiteAdapter,
  audible: audibleAdapter,
  pokedora: pokedoraAdapter,
};

/** 見出しに出すストア名 */
const STORE_LABELS: Record<StoreSlug, string> = {
  dlsite: "DLsite",
  audible: "Audible",
  pokedora: "ポケットドラマCD",
};

const USAGE = `使い方:
  node crawler/cli.ts actor "<声優名>" [オプション]
  node crawler/cli.ts diff  "<声優名>" [オプション]

オプション:
  --store <slug>            指定したストアだけを対象にする (dlsite / audible / pokedora)
  --json                    RawWork[] を JSON で出力する
  --no-snapshot             取得した生データを .cache/snapshots に保存しない
  --skip-known <id,id,...>  既知の作品 ID の詳細取得を飛ばす
`;

function isStoreSlug(value: string): value is StoreSlug {
  return (STORE_SLUGS as readonly string[]).includes(value);
}

const OPTION_SPEC = {
  store: { type: "string" },
  json: { type: "boolean" },
  "no-snapshot": { type: "boolean" },
  "skip-known": { type: "string" },
  help: { type: "boolean", short: "h" },
} as const;

/**
 * 入力した声優名を検索候補に組み立てる。
 *
 * 対象声優リストに canonicalName / slug / alias のどれかで一致する声優がいれば、
 * その検証済みの空白入り alias を Audible 向けの先頭候補として使う (`buildSearchNames` と同じ考え方)。
 * 見つからなければ入力した文字列だけで検索する。DLsite は canonicalName だけを見るので、
 * どちらの場合も canonicalName には入力した文字列をそのまま使う (これまでの挙動を変えないため)
 */
async function buildActorQuery(actorName: string): Promise<ActorQuery> {
  const seeds = await loadActorSeeds().catch(() => [] as ActorSeed[]);
  const matched = seeds.find(
    (seed) =>
      seed.canonicalName === actorName ||
      seed.slug === actorName ||
      (seed.aliases ?? []).some((alias) => alias.name === actorName),
  );
  const spaced = matched === undefined ? [] : spacedVerifiedAliasNames(matched);
  const searchNames = spaced.length > 0 ? [...spaced, actorName] : [actorName];
  // ポケドラは名前で検索できない。辞書があれば tag_id を引いて渡す (辞書が無ければ空振りになる)
  const pokedoraRefs = lookupActor(await loadPokedoraDirectory(), actorName);
  return {
    canonicalName: actorName,
    searchNames,
    ...(pokedoraRefs === undefined ? {} : { storeActorRefs: { pokedora: pokedoraRefs } }),
  };
}

/** 引数の形が不正なら使い方を出して undefined を返す */
function parseCliArgs(argv: readonly string[]) {
  try {
    return parseArgs({ args: [...argv], options: OPTION_SPEC, allowPositionals: true });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return undefined;
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseCliArgs(argv);
  if (parsed === undefined) return 1;

  const { values, positionals } = parsed;
  if (values.help === true) {
    process.stdout.write(USAGE);
    return 0;
  }

  const [command, actorName] = positionals;
  if (command !== "actor" && command !== "diff") {
    process.stderr.write(`不明なコマンド: ${command ?? "(なし)"}\n\n${USAGE}`);
    return 1;
  }
  if (actorName === undefined || actorName.trim() === "") {
    process.stderr.write(`声優名を指定してください\n\n${USAGE}`);
    return 1;
  }

  const storeFilter = values.store;
  if (storeFilter !== undefined && !isStoreSlug(storeFilter)) {
    process.stderr.write(
      `--store は ${STORE_SLUGS.join(" / ")} のどれかを指定してください: ${storeFilter}\n`,
    );
    return 1;
  }
  const stores: readonly StoreSlug[] = storeFilter === undefined ? STORE_SLUGS : [storeFilter];

  const skipKnownIds = new Set(
    (values["skip-known"] ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id !== ""),
  );

  const query = await buildActorQuery(actorName);
  const results: AdapterResult[] = [];
  for (const store of stores) {
    const adapter = ADAPTERS[store];
    // ストアをまたいで直列に回す。レートリミッタはホストごとなので並行にしても速くはならず、
    // 失敗したときにどのストアまで進んだかが分かりにくくなるだけ
    results.push(
      await adapter.fetchByActor(query, {
        skipKnownIds,
        snapshot: values["no-snapshot"] !== true,
      }),
    );
  }

  for (const result of results) {
    // 網羅率。並び順違いの補完リクエストが出たかどうかも `pages` で分かる
    if (result.coverage !== undefined) {
      process.stderr.write(
        `[網羅] ${STORE_LABELS[result.storeSlug]}: ${formatCoverage(result.coverage)}\n`,
      );
    }
    for (const warning of result.warnings) {
      process.stderr.write(`[警告] ${STORE_LABELS[result.storeSlug]}: ${warning}\n`);
    }
    if (result.invalidCount > 0) {
      process.stderr.write(
        `[警告] ${STORE_LABELS[result.storeSlug]}: ${result.invalidCount} 件が検証に失敗し除外されました\n`,
      );
    }
    if (result.status === "error") {
      process.stderr.write(`[エラー] ${STORE_LABELS[result.storeSlug]}: ${result.reason}\n`);
    }
  }

  if (values.json === true) {
    process.stdout.write(
      `${JSON.stringify(
        results.flatMap((result) => result.works),
        null,
        2,
      )}\n`,
    );
  } else if (command === "actor") {
    process.stdout.write(formatActorOutput(results));
  } else {
    process.stdout.write(await runDiff(actorName, results));
  }

  // 全ストアが失敗したときだけ異常終了にする。片方だけなら結果は使えるため
  return results.every((result) => result.status === "error") ? 1 : 0;
}

/**
 * 網羅率の 1 行。総件数が取れなければ「総件数不明」とだけ書く。
 * 取れないことと取りこぼしが無いことを言葉の上でも混ぜないため
 */
function formatCoverage(coverage: Coverage): string {
  const pages = `検索 ${coverage.pages} ページ`;
  if (coverage.total === undefined) return `取得 ${coverage.fetched} 件 / 総件数不明 (${pages})`;
  const verdict = coverage.complete === true ? "完全" : "取りこぼしあり";
  return `取得 ${coverage.fetched} 件 / 総件数 ${coverage.total} (${verdict}、${pages})`;
}

// --- 出力 ------------------------------------------------------------------

/** 発売日が無い作品のための桁合わせ。日付欄の幅は "YYYY-MM-DD" の 10 桁 */
const UNKNOWN_DATE = "----------";

/** 新しい順。発売日が無いものは日付が分かるものより後ろへ回す */
function byReleaseDateDesc(a: RawWork, b: RawWork): number {
  const left = a.releaseDate ?? "";
  const right = b.releaseDate ?? "";
  if (left === right) return a.titleRaw.localeCompare(b.titleRaw, "ja");
  if (left === "") return 1;
  if (right === "") return -1;
  return left < right ? 1 : -1;
}

export function formatActorOutput(results: readonly AdapterResult[]): string {
  const blocks = results.map((result) => {
    const lines = [STORE_LABELS[result.storeSlug]];
    if (result.status === "error") {
      lines.push(`(取得できませんでした: ${result.reason})`);
    } else if (result.works.length === 0) {
      // empty は「該当なし」と分かっている 0 件。理由を添えて ok の 0 件と区別できるようにする
      lines.push(result.status === "empty" ? `(該当作品なし: ${result.reason})` : "(該当作品なし)");
    } else {
      for (const work of [...result.works].sort(byReleaseDateDesc)) {
        lines.push(`${work.releaseDate ?? UNKNOWN_DATE}  ${work.titleRaw}`);
      }
    }
    return `${lines.join("\n")}\n`;
  });
  return blocks.join("\n");
}

// --- diff ------------------------------------------------------------------

type LastResult = {
  actorName: string;
  storeSlug: StoreSlug;
  savedAt: string;
  storeProductIds: string[];
};

function lastResultPath(storeSlug: StoreSlug, actorName: string): string {
  return path.join(LAST_RESULT_DIR, storeSlug, `${safeFileName(actorName)}.json`);
}

async function readLastResult(
  storeSlug: StoreSlug,
  actorName: string,
): Promise<LastResult | undefined> {
  let text: string;
  try {
    text = await readFile(lastResultPath(storeSlug, actorName), "utf8");
  } catch {
    // 初回はファイルが無い。読めない場合も「前回結果なし」として扱う
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const ids = (parsed as { storeProductIds?: unknown }).storeProductIds;
    if (!Array.isArray(ids)) return undefined;
    return {
      actorName,
      storeSlug,
      savedAt: String((parsed as { savedAt?: unknown }).savedAt ?? ""),
      storeProductIds: ids.filter((id): id is string => typeof id === "string"),
    };
  } catch {
    return undefined;
  }
}

async function writeLastResult(result: AdapterResult): Promise<void> {
  const file = lastResultPath(result.storeSlug, result.actorName);
  await mkdir(path.dirname(file), { recursive: true });
  const payload: LastResult = {
    actorName: result.actorName,
    storeSlug: result.storeSlug,
    savedAt: new Date().toISOString(),
    // 差分判定に要るのは ID だけ。作品の中身は snapshots 側に残る
    storeProductIds: result.works.map((work) => work.storeProductId),
  };
  await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function runDiff(
  actorName: string,
  results: readonly AdapterResult[],
): Promise<string> {
  const lines: string[] = ["New since previous crawl:"];
  let hadPrevious = false;
  let newCount = 0;

  for (const result of results) {
    // 取得に失敗したストアは前回結果を上書きしない。0 件で保存すると
    // 次回に全作品が「新着」として出てしまうため (empty は該当なしと確定しているので保存する)
    if (result.status === "error") continue;

    const previous = await readLastResult(result.storeSlug, actorName);
    if (previous === undefined) {
      lines.push(`(${STORE_LABELS[result.storeSlug]}: 前回結果なし。今回の結果を保存しました)`);
    } else {
      hadPrevious = true;
      const known = new Set(previous.storeProductIds);
      for (const work of [...result.works].sort(byReleaseDateDesc)) {
        if (known.has(work.storeProductId)) continue;
        lines.push(`+ ${STORE_LABELS[result.storeSlug]} ${work.titleRaw}`);
        newCount += 1;
      }
    }
    await writeLastResult(result);
  }

  if (hadPrevious && newCount === 0) lines.push("(増えた作品はありません)");
  return `${lines.join("\n")}\n`;
}

// 直接実行されたときだけ動かす (テストから import しても main が走らないようにするため)
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const code = await main(process.argv.slice(2));
  process.exitCode = code;
}
