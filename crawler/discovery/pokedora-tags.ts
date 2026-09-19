import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { fetchText } from "../lib/fetch.ts";
import { CACHE_DIR } from "../lib/paths.ts";

/**
 * ポケドラの声優タグ辞書を作る (ポケドラの取得手順の段階 1)。
 *
 *   node crawler/discovery/pokedora-tags.ts --resume
 *
 * `sitemap_tags_1.xml.gz` に 6,939 件のタグ URL が入っているが、名前は入っていない。
 * `tag_type=1` (声優) の 3,161 件について各タグページを引き、`<title>` から名前を取る。
 * 5 秒間隔なので 4.4 時間の一度きりのバッチになる。途中で落ちても `--resume` で続きから走る。
 *
 * 同じページにストア別の件数内訳が出るので一緒に記録する。これがあると
 * 「この声優がポケドラに何作品あるか」が辞書だけで分かり、段階 3 を交差した声優に絞り込める。
 *
 * 年齢認証の背後にある `store=adt` / `store=adt-bl` のページは引かない。
 * 既定のストア (一般) のページに 4 ストアぶんの件数が出るので、引く必要もない。
 *
 * DB には一切書き込まない。結果は crawler/.cache/discovery/pokedora-tags.json に置く
 */

const STORE = "pokedora";
const DISCOVERY_DIR = path.join(CACHE_DIR, "discovery");
export const TAGS_JSON = path.join(DISCOVERY_DIR, "pokedora-tags.json");

export const TAGS_SITEMAP_URL = "https://pokedora.com/sitemap_tags_1.xml.gz";
/** 声優を表す tag_type。1=声優 / 2=シリーズ / 3=レーベル / 4=原作者等 (調査済み) */
export const VOICE_ACTOR_TAG_TYPE = 1;

/** 何件ごとに進捗を出すか */
const PROGRESS_EVERY = 50;
/** 同じ失敗がこれだけ続いたら、相手の状態が変わったとみなして止める */
const CONSECUTIVE_FAILURE_LIMIT = 10;
const FORBIDDEN = 403;
const TOO_MANY_REQUESTS = 429;

// --- sitemap の解析 (純粋関数) ---------------------------------------------

export type TagSitemapEntry = { tagType: number; tagId: number };

/**
 * gzip で来ることも、サーバーが Content-Encoding で展開済みを返すこともある。
 * gzip のマジックバイト (1f 8b) を見てから展開を決める
 */
export function decodeSitemapBytes(bytes: Uint8Array): string {
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  const raw = isGzip ? gunzipSync(bytes) : bytes;
  return new TextDecoder("utf-8").decode(raw);
}

/**
 * `<loc>https://pokedora.com/tags/?tag_type=1&amp;tag_id=1920</loc>` の形から
 * tag_type と tag_id を取り出す。XML なので `&` は `&amp;` で来る
 */
export function parseTagSitemap(xml: string): TagSitemapEntry[] {
  const entries: TagSitemapEntry[] = [];
  for (const match of xml.matchAll(/<loc>\s*([^<\s][^<]*?)\s*<\/loc>/g)) {
    const loc = match[1];
    if (loc === undefined) continue;
    const tagType = Number(/[?&](?:amp;)?tag_type=(\d+)/.exec(loc)?.[1]);
    const tagId = Number(/[?&](?:amp;)?tag_id=(\d+)/.exec(loc)?.[1]);
    if (!Number.isFinite(tagType) || !Number.isFinite(tagId)) continue;
    entries.push({ tagType, tagId });
  }
  return entries;
}

/** 声優タグの ID を昇順・重複なしで取り出す */
export function voiceActorTagIds(entries: readonly TagSitemapEntry[]): number[] {
  const ids = new Set<number>();
  for (const entry of entries) {
    if (entry.tagType === VOICE_ACTOR_TAG_TYPE) ids.add(entry.tagId);
  }
  return [...ids].sort((a, b) => a - b);
}

// --- タグページの解析 (純粋関数) -------------------------------------------

/**
 * `<title>声優【小林千晃】のボイス・ASMR、…</title>` から名前を取る。
 *
 * タグページは tag_type ごとに接頭辞が違う (シリーズなら「シリーズ【…】」) ので、
 * 「声優」で始まることまで見る。別 tag_type のページを誤って声優として拾わないため
 */
export function extractActorName(html: string): string | undefined {
  const title = /<title>([\s\S]*?)<\/title>/.exec(html)?.[1];
  if (title === undefined) return undefined;
  const name = /^\s*声優【([^】]+)】/.exec(title)?.[1]?.trim();
  return name === undefined || name === "" ? undefined : name;
}

/** ポケドラのストア区分。オトナ向け 2 つは件数だけ数え、ページは引かない */
export const STORE_KEYS = ["men", "bl", "adt", "adt-bl"] as const;
export type StoreKey = (typeof STORE_KEYS)[number];
export type StoreCounts = Record<StoreKey, number>;

/**
 * ストア切り替えタブから 4 ストアの件数を取る。
 *
 *   <li class="category_tab_el category_tab_el-bl"> … <div …>(66件)</div> … </li>
 *
 * クラス名の末尾までを見ているのは `category_tab_el-adt` が `category_tab_el-adt-bl` の
 * 接頭辞になっていて、前方一致だとオトナ BL を「オトナ向け」として二重に数えるため
 */
export function parseStoreCounts(html: string): StoreCounts | undefined {
  const counts: Partial<StoreCounts> = {};
  const blocks = html.matchAll(
    /<li class="category_tab_el category_tab_el-(men|bl|adt|adt-bl)">([\s\S]*?)<\/li>/g,
  );
  for (const block of blocks) {
    const key = block[1] as StoreKey | undefined;
    const inner = block[2];
    if (key === undefined || inner === undefined) continue;
    const count = Number(/\((\d+)件\)/.exec(inner)?.[1]);
    if (!Number.isFinite(count)) continue;
    counts[key] = count;
  }
  // 4 つ揃わないときは HTML の形が変わった可能性があるので、部分的な数字を信じない
  if (STORE_KEYS.some((key) => counts[key] === undefined)) return undefined;
  return counts as StoreCounts;
}

export function tagPageUrl(tagId: number): string {
  return `https://pokedora.com/tags/?tag_type=${VOICE_ACTOR_TAG_TYPE}&tag_id=${tagId}`;
}

// --- 収集結果 --------------------------------------------------------------

/**
 * 1 タグぶんの結果。失敗も記録して残す。
 * 「引いたが名前が無かった」と「まだ引いていない」を区別できないと再開のたびに取り直してしまう
 */
export type PokedoraTagRecord = {
  tagId: number;
  /** ok=名前が取れた / no-name=引けたが title から名前が取れない / failed=取得自体に失敗 */
  status: "ok" | "no-name" | "failed";
  name?: string;
  counts?: StoreCounts;
  /** counts の 4 ストア合計。集計を楽にするため持たせる */
  total?: number;
  /** HTTP ステータス。ネットワークエラーでは undefined */
  httpStatus?: number;
  reason?: string;
  fetchedAt: string;
};

export type PokedoraTagsCache = {
  sitemapUrl: string;
  /** sitemap に載っていた声優タグの総数 */
  tagIdCount: number;
  /** sitemap 全体のタグ数 (tag_type を問わない)。調査の裏取り用 */
  sitemapUrlCount: number;
  startedAt: string;
  updatedAt: string;
  records: PokedoraTagRecord[];
};

export function summarizeRecords(records: readonly PokedoraTagRecord[]): {
  total: number;
  ok: number;
  noName: number;
  failed: number;
  failuresByStatus: Record<string, number>;
} {
  const failuresByStatus: Record<string, number> = {};
  let ok = 0;
  let noName = 0;
  let failed = 0;
  for (const record of records) {
    if (record.status === "ok") ok += 1;
    else if (record.status === "no-name") noName += 1;
    else {
      failed += 1;
      const key = record.httpStatus === undefined ? "network" : String(record.httpStatus);
      failuresByStatus[key] = (failuresByStatus[key] ?? 0) + 1;
    }
  }
  return { total: records.length, ok, noName, failed, failuresByStatus };
}

// --- 入出力 ----------------------------------------------------------------

/**
 * 一時ファイルに書いてから rename する。4.4 時間のバッチの途中で中断されても
 * JSON が壊れていないことを保証するため (壊れると再開できず全部やり直しになる)
 */
async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}

async function readCache(filePath: string): Promise<PokedoraTagsCache | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as PokedoraTagsCache;
  } catch {
    return undefined;
  }
}

// --- 取得 ------------------------------------------------------------------

export async function fetchVoiceActorTagIds(options: {
  snapshot?: boolean;
}): Promise<{ tagIds: number[]; sitemapUrlCount: number }> {
  const result = await fetchText(TAGS_SITEMAP_URL, {
    store: STORE,
    requestKey: "sitemap_tags_1",
    kind: "binary",
    snapshot: options.snapshot,
  });
  if (!result.ok) throw new Error(`タグ sitemap の取得に失敗: ${result.reason}`);
  if (result.bytes === undefined) throw new Error("タグ sitemap の本文が空だった");
  const entries = parseTagSitemap(decodeSitemapBytes(result.bytes));
  return { tagIds: voiceActorTagIds(entries), sitemapUrlCount: entries.length };
}

/** 呼び出し側に止める理由を返す。403 / 429 と連続失敗は相手の状態が変わった合図 */
type StopReason = { kind: "forbidden" | "rate-limited" | "consecutive-failures"; detail: string };

export async function crawlTagPages(options: {
  tagIds: readonly number[];
  cache: PokedoraTagsCache;
  snapshot?: boolean;
  onProgress?: (done: number, totalToFetch: number) => void;
}): Promise<{ stop?: StopReason }> {
  const { tagIds, cache } = options;
  let consecutiveFailures = 0;
  let done = 0;

  for (const tagId of tagIds) {
    const result = await fetchText(tagPageUrl(tagId), {
      store: STORE,
      requestKey: `tag-${tagId}`,
      kind: "html",
      snapshot: options.snapshot,
    });
    const fetchedAt = new Date().toISOString();

    if (!result.ok) {
      cache.records.push({
        tagId,
        status: "failed",
        ...(result.status === undefined ? {} : { httpStatus: result.status }),
        reason: result.reason,
        fetchedAt,
      });
      cache.updatedAt = fetchedAt;
      await writeJsonAtomic(TAGS_JSON, cache);
      done += 1;
      options.onProgress?.(done, tagIds.length);

      // 403 と 429 はこちらの取り方を相手が拒んでいる合図なので、その場で止めて人が判断する
      if (result.status === FORBIDDEN) {
        return { stop: { kind: "forbidden", detail: `tag_id=${tagId}: ${result.reason}` } };
      }
      if (result.status === TOO_MANY_REQUESTS) {
        return { stop: { kind: "rate-limited", detail: `tag_id=${tagId}: ${result.reason}` } };
      }
      consecutiveFailures += 1;
      if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
        return {
          stop: {
            kind: "consecutive-failures",
            detail: `${consecutiveFailures} 件連続で失敗 (最後: tag_id=${tagId} ${result.reason})`,
          },
        };
      }
      continue;
    }

    consecutiveFailures = 0;
    const name = extractActorName(result.body);
    const counts = parseStoreCounts(result.body);
    const total =
      counts === undefined ? undefined : STORE_KEYS.reduce((sum, key) => sum + counts[key], 0);
    cache.records.push({
      tagId,
      status: name === undefined ? "no-name" : "ok",
      ...(name === undefined ? {} : { name }),
      ...(counts === undefined ? {} : { counts }),
      ...(total === undefined ? {} : { total }),
      httpStatus: result.status,
      fetchedAt,
    });
    cache.updatedAt = fetchedAt;
    await writeJsonAtomic(TAGS_JSON, cache);
    done += 1;
    options.onProgress?.(done, tagIds.length);
  }

  return {};
}

// --- CLI -------------------------------------------------------------------

const USAGE = `使い方:
  node crawler/discovery/pokedora-tags.ts [オプション]

オプション:
  --limit <N>    引くタグ数の上限 (既定: 全件)
  --resume       既存の .cache/discovery/pokedora-tags.json を読み、取得済みの tag_id を飛ばす
  --retry-failed --resume と併用。前回失敗した tag_id を取り直す
  --snapshot     タグページの HTML を .cache/snapshots に残す (3,161 件で数百 MB になる)
`;

const OPTION_SPEC = {
  limit: { type: "string" },
  resume: { type: "boolean" },
  "retry-failed": { type: "boolean" },
  snapshot: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  return `${Math.floor(totalMinutes / 60)} 時間 ${totalMinutes % 60} 分`;
}

export async function main(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({ args: [...argv], options: OPTION_SPEC, allowPositionals: false });
  if (values.help === true) {
    console.log(USAGE);
    return 0;
  }

  const resume = values.resume === true;
  const retryFailed = values["retry-failed"] === true;
  // 既定はスナップショット無し。タグページは 1 件 80KB あり、全件残すと数百 MB になる。
  // 必要な情報は JSON に落とすので、再現性はそちらで担保する (dlsite-sitemap.ts と同じ判断)
  const snapshot = values.snapshot === true;
  const startedAt = Date.now();

  console.log(`タグ sitemap を取得: ${TAGS_SITEMAP_URL}`);
  const { tagIds, sitemapUrlCount } = await fetchVoiceActorTagIds({ snapshot });
  console.log(`  タグ URL ${sitemapUrlCount} 件 / うち声優 (tag_type=1) ${tagIds.length} 件`);

  const existing = resume ? await readCache(TAGS_JSON) : undefined;
  const cache: PokedoraTagsCache = existing ?? {
    sitemapUrl: TAGS_SITEMAP_URL,
    tagIdCount: tagIds.length,
    sitemapUrlCount,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    records: [],
  };
  if (existing !== undefined) {
    // sitemap は再取得しているので、件数は今回の値に更新する
    cache.tagIdCount = tagIds.length;
    cache.sitemapUrlCount = sitemapUrlCount;
    if (retryFailed) {
      const before = cache.records.length;
      cache.records = cache.records.filter((record) => record.status !== "failed");
      console.log(`  前回の失敗 ${before - cache.records.length} 件を取り直す`);
    }
    console.log(`  再開: 取得済み ${cache.records.length} 件を飛ばす`);
  }

  const doneIds = new Set(cache.records.map((record) => record.tagId));
  let pending = tagIds.filter((tagId) => !doneIds.has(tagId));
  const limit = values.limit === undefined ? undefined : Number(values.limit);
  if (limit !== undefined && Number.isFinite(limit)) pending = pending.slice(0, limit);

  console.log(
    `これから引く: ${pending.length} 件 (見込み ${formatDuration(pending.length * 5000)})`,
  );

  const { stop } = await crawlTagPages({
    tagIds: pending,
    cache,
    snapshot,
    onProgress: (done, totalToFetch) => {
      if (done % PROGRESS_EVERY !== 0 && done !== totalToFetch) return;
      const summary = summarizeRecords(cache.records);
      const elapsed = Date.now() - startedAt;
      const remaining = ((totalToFetch - done) * elapsed) / Math.max(done, 1);
      console.log(
        `[${done}/${totalToFetch}] 累計 ${summary.total}/${cache.tagIdCount} ` +
          `名前 ${summary.ok} / 名前なし ${summary.noName} / 失敗 ${summary.failed} ` +
          `(経過 ${formatDuration(elapsed)} / 残り ${formatDuration(remaining)})`,
      );
    },
  });

  const summary = summarizeRecords(cache.records);
  console.log("");
  console.log(`結果: ${TAGS_JSON}`);
  console.log(`  声優タグ ${cache.tagIdCount} 件中 ${summary.total} 件を処理`);
  console.log(`  名前が取れた: ${summary.ok}`);
  console.log(`  名前が取れなかった: ${summary.noName}`);
  console.log(`  取得に失敗: ${summary.failed} ${JSON.stringify(summary.failuresByStatus)}`);
  console.log(`  所要: ${formatDuration(Date.now() - startedAt)}`);

  if (stop !== undefined) {
    console.error("");
    console.error(`中断しました (${stop.kind}): ${stop.detail}`);
    console.error("--resume で続きから再開できます");
    return 1;
  }
  return 0;
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
