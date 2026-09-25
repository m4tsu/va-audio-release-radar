import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { INGEST_PROTOCOL_VERSION, type IngestPayload } from "../src/contract/index.ts";
import { isSingleWordFullName, STORE_SLUGS, type StoreSlug } from "../src/domain/index.ts";
import { audibleAdapter } from "./adapters/audible.ts";
import { dlsiteAdapter } from "./adapters/dlsite.ts";
import { pokedoraAdapter } from "./adapters/pokedora.ts";
import type { ActorQuery, AdapterResult, AdapterStatus, SourceAdapter } from "./adapters/types.ts";
import {
  appendActorRefs,
  loadPokedoraDirectory,
  lookupActor,
} from "./discovery/pokedora-directory.ts";
import { asString } from "./lib/cli.ts";
import {
  AdminApiClient,
  AdminApiError,
  type CrawlActor,
  failureReport,
  IngestProtocolMismatchError,
  spacedUnverifiedAliasNames,
  spacedVerifiedAliasNames,
} from "./lib/ingest.ts";
import { STORE_COLUMN_LABELS } from "./lib/labels.ts";
import { spacedNameCandidates } from "./lib/spaced-name.ts";

/**
 * 声優起点の走行の本体。GitHub Actions からも手元からも同じものを動かす。
 *
 *   INGEST_TOKEN=dev node crawler/run.ts --base-url http://localhost:5199
 *
 * 手順:
 *   1. 対象声優を `GET /api/admin/actors` で引く。台帳は DB にしかないので、リストのファイルは読まない
 *   2. 声優 × ストアごとに adapter で取得し、`IngestPayload` を `POST /api/admin/ingest` に送る
 *   3. 集計表を標準出力に出す
 *
 * 取得に失敗しても `error` 付きで必ず送る。crawl_runs に失敗が残らないと、管理画面から
 * 「クローラーが壊れている」ことに気づけないため。失敗があっても全件送り切ってから終了コード 1 にする
 */

const ADAPTERS: Record<StoreSlug, SourceAdapter> = {
  dlsite: dlsiteAdapter,
  audible: audibleAdapter,
  pokedora: pokedoraAdapter,
};

const ALL_STORES: readonly StoreSlug[] = STORE_SLUGS;

const USAGE = `使い方:
  INGEST_TOKEN=... node crawler/run.ts --base-url https://example.workers.dev [オプション]

オプション:
  --base-url <URL>          取り込み先。環境変数 INGEST_URL でも指定できる
  --only <名前,名前>        指定した声優 (canonicalName または slug) だけを対象にする
  --never-crawled           一度も引いたことがない声優だけを対象にする (古い順)
  --with-works              作品を持つ声優だけを対象にする (月次の引き直し)
  --store <slug>            1 つのストアだけを対象にする (dlsite / audible / pokedora)
  --offset <N>              先頭 N 人の声優を飛ばす (--limit と併用して途中から再開する)
  --limit <N>               (--offset のぶんを飛ばした後) N 人の声優だけを対象にする
  --shard <i/n>             対象を n 組に分けた i 番目だけを引く (月次を複数ジョブに分ける)
  --dry-run                 取得はするが DB へは送らない (対象声優の読み取りだけは行う)
  --no-snapshot             取得した生データを .cache/snapshots に保存しない
  --no-skip-known           既知 ID の詳細取得を飛ばさず、毎回すべて取り直す
`;

const OPTION_SPEC = {
  "base-url": { type: "string" },
  only: { type: "string" },
  "never-crawled": { type: "boolean" },
  "with-works": { type: "boolean" },
  store: { type: "string" },
  offset: { type: "string" },
  limit: { type: "string" },
  shard: { type: "string" },
  "dry-run": { type: "boolean" },
  "no-snapshot": { type: "boolean" },
  "no-skip-known": { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

function isStoreSlug(value: string): value is StoreSlug {
  return (STORE_SLUGS as readonly string[]).includes(value);
}

// --- 集計 ------------------------------------------------------------------

/**
 * 保存の結果。adapter の取得結果 (`AdapterStatus`) とは別に持つ。
 *
 * 混ぜると、取得は成功したのに ingest に拒否された声優が「取得成功」に数えられる。
 * 取得の成否と保存の成否は別の事実なので別に数える
 *
 * - `saved`: ingest が受け取って保存まで終えた
 * - `failed`: ingest に届かなかった / 受け付けられなかった
 * - `skipped`: --dry-run なのでそもそも送っていない
 */
export type SaveStatus = "saved" | "failed" | "skipped";

/** 声優 1 人 × ストア 1 つの結果。最後の表と終了コードの材料 */
export type RunOutcome = {
  actor: CrawlActor;
  storeSlug: StoreSlug;
  status: AdapterStatus;
  /** adapter が取れた作品数。保存できたかどうかとは無関係 */
  fetchedCount: number;
  /** 実際に保存された作品数 (ingest の upserted)。保存に失敗したときは 0 */
  workCount: number;
  newCount: number;
  unmatchedCount: number;
  /** empty / error の理由、または送信そのものに失敗した理由 */
  reason?: string;
  /** 実際に検索に使った語。Audible は空白入り別名フォールバックがあるため canonicalName と違うことがある */
  queryUsed?: string;
  /** この走行で「もう買えない」と分かった作品の数 */
  delistedCount: number;
  /** 検索の上限に当たって、取り切れなかったか。分からなければ undefined */
  coverageComplete?: boolean;
  save: SaveStatus;
  /**
   * `save: "failed"` のとき、失敗したことを `crawl_runs` に残せたか。
   * false なら DB 上は何も起きなかったことになるので、最終集計で別枠にして人に見せる
   */
  failureRecorded?: boolean;
};

export type RunSummary = {
  actors: number;
  ok: number;
  empty: number;
  error: number;
  /** adapter が取れた作品数の合計 */
  fetched: number;
  /** 実際に DB へ保存された作品数の合計 */
  works: number;
  new: number;
  unmatched: number;
  /** 保存まで成功した 声優×ストア の数 */
  saved: number;
  /** 取得はできたが保存に失敗した数 */
  saveFailed: number;
  /** 保存に失敗し、その失敗すら crawl_runs に残せなかった数 */
  saveFailedUnrecorded: number;
  /** もう買えないと分かった作品の数 */
  delisted: number;
  /** 検索の上限に当たって取り切れなかった 声優×ストア の数 */
  incomplete: number;
};

export function summarize(outcomes: readonly RunOutcome[]): RunSummary {
  const summary: RunSummary = {
    actors: new Set(outcomes.map((outcome) => outcome.actor.id)).size,
    ok: 0,
    empty: 0,
    error: 0,
    fetched: 0,
    works: 0,
    new: 0,
    unmatched: 0,
    saved: 0,
    saveFailed: 0,
    saveFailedUnrecorded: 0,
    delisted: 0,
    incomplete: 0,
  };
  for (const outcome of outcomes) {
    summary[outcome.status] += 1;
    summary.fetched += outcome.fetchedCount;
    summary.works += outcome.workCount;
    summary.new += outcome.newCount;
    summary.unmatched += outcome.unmatchedCount;
    summary.delisted += outcome.delistedCount;
    if (outcome.coverageComplete === false) summary.incomplete += 1;
    if (outcome.save === "saved") summary.saved += 1;
    if (outcome.save === "failed") {
      summary.saveFailed += 1;
      if (outcome.failureRecorded !== true) summary.saveFailedUnrecorded += 1;
    }
  }
  return summary;
}

/**
 * 声優ごとに 1 行の表。どの声優のどのストアが空・失敗だったかを一目で追えるようにする。
 *
 * 時間切れで打ち切られた走行はここまで来ない (プロセスごと止められる)。
 * どこまで進んだかは走行中に出る `[k/N] 名前` の行と `crawl_runs` の行数で追う
 */
export function formatOutcomeTable(outcomes: readonly RunOutcome[]): string {
  // 列はストアが増えても勝手に増える。`--store` で 1 つに絞った走行でも全ストアの列を出し、
  // 引かなかったストアは "-" にする (0 件と「そもそも取っていない」を混ぜないため)
  const header = [
    "声優",
    ...ALL_STORES.flatMap((storeSlug) => [STORE_COLUMN_LABELS[storeSlug], "new"]),
    "備考",
  ];
  const byActor = new Map<string, RunOutcome[]>();
  for (const outcome of outcomes) {
    const list = byActor.get(outcome.actor.id);
    if (list) list.push(outcome);
    else byActor.set(outcome.actor.id, [outcome]);
  }

  const rows = [...byActor.values()].map((group) => {
    const notes = group.flatMap((outcome) => {
      const parts: string[] = [];
      if (outcome.status !== "ok") parts.push(`${outcome.storeSlug}:${outcome.status}`);
      // 取得できたのに保存できなかったことは、取得失敗とは別に必ず表に出す。
      // 表に出さないと、0 件の声優と見分けが付かない
      if (outcome.save === "failed") {
        parts.push(
          outcome.failureRecorded === true
            ? `${outcome.storeSlug}:save-failed`
            : `${outcome.storeSlug}:save-failed(未記録)`,
        );
      }
      // canonicalName のまま確定した場合は自明なので出さない。空白入り別名で確定したときだけ出す
      if (outcome.queryUsed !== undefined && outcome.queryUsed !== outcome.actor.canonicalName) {
        parts.push(`${outcome.storeSlug}:query=${outcome.queryUsed}`);
      }
      return parts;
    });
    return [
      group[0]?.actor.canonicalName ?? "",
      ...ALL_STORES.flatMap((storeSlug) => [
        cell(group, storeSlug, (outcome) => String(outcome.workCount)),
        cell(group, storeSlug, (outcome) => String(outcome.newCount)),
      ]),
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

/**
 * 対象声優を台帳から引く。
 *
 * 検索に使う空白入りの表記は保存された別名義だけを読み、残りは `buildSearchNames` が
 * 日本語表記から作る。当てずっぽうの切り方を辞書に溜めると、名寄せがその表記でも当たるようになる
 */
export async function loadCrawlActors(
  client: AdminApiClient,
  options: { neverCrawled?: boolean; withWorks?: boolean } = {},
): Promise<CrawlActor[]> {
  return client.listActors(options);
}

/**
 * Audible 向けの検索候補。DLsite adapter はこの配列を無視して canonicalName の完全一致検索だけを行う。
 *
 * 順番は 検証済みの空白入り別名義 → canonicalName → 機械的に切った空白入りの候補。
 *
 * - 検証済みが先頭なのは実測どおり (「石見舞菜香」は該当なし、「石見 舞菜香」だと 2 件)
 * - 機械的な候補を canonicalName の後ろに置くのは、切る位置が当てずっぽうだから。
 *   adapter は 1 件以上取れた時点で打ち切るので、canonicalName で引ける大多数の声優に
 *   余分な検索リクエストは出ない
 * - それでも候補に含めるのは、含めないと Audible の空白問題 (石見舞菜香 と同じ形) を
 *   一切吸収できないため
 *
 * 機械的な候補は日本語表記からその場で作る。台帳に保存しないのは、当てずっぽうの表記が
 * 別名義の表に入ると、ストアのクレジット表記の照合がその表記でも当たるようになるため
 */
export function buildSearchNames(actor: CrawlActor): string[] {
  const verified = spacedVerifiedAliasNames(actor);
  if (verified.length > 0) return [...verified, actor.canonicalName];
  const stored = spacedUnverifiedAliasNames(actor);
  if (stored.length > 0) return [actor.canonicalName, ...stored];
  // 1 語の名義 (「ゆかな」「麦人」「KENN」) には姓と名の境界が無い。機械的に切ると
  // 存在しない表記で 2 回余計に検索することになるので、候補を作らない。
  // ローマ字を持たない声優は slug で代用する (slug はローマ字から作られている)
  const romaji = actor.nameEn ?? actor.slug.replace(/-/g, " ");
  const generated = isSingleWordFullName(romaji) ? [] : spacedNameCandidates(actor.canonicalName);
  return [actor.canonicalName, ...generated];
}

/**
 * `--offset` / `--limit` で対象を切り出す。
 *
 * `--offset` があるのは、途中で落ちた走行を続きから再開するため。500 人のクロールは
 * 3 時間かかるので、81 人目から失敗したときに先頭からやり直すと相手サイトへの往復が
 * 二重になる。`--limit` は offset を適用した後の人数として数える
 * (「81 人目から 420 人」がそのまま書けるようにするため)
 */
export function sliceActors(
  actors: readonly CrawlActor[],
  offset: number | undefined,
  limit: number | undefined,
): CrawlActor[] {
  const start = offset ?? 0;
  const end = limit === undefined ? undefined : start + limit;
  return actors.slice(start, end);
}

export type Shard = { index: number; total: number };

/**
 * `--shard i/n` を読む。`i` は 1 始まり。形が違えば undefined を返す
 */
export function parseShard(value: string | undefined): Shard | undefined {
  if (value === undefined) return undefined;
  const matched = /^(\d+)\/(\d+)$/.exec(value);
  if (matched === null) return undefined;
  const index = Number(matched[1]);
  const total = Number(matched[2]);
  if (total < 1 || index < 1 || index > total) return undefined;
  return { index, total };
}

/**
 * 声優 ID から毎回同じ数を作る (FNV-1a 32bit)。
 * 組分けが走行ごとに変わらなければよく、分布の質は問わない
 */
function hashActorId(id: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * `--shard i/n` で対象を分ける。
 *
 * 声優 ID のハッシュで分けるので、どの組に入るかは他の声優が増えても変わらない。
 * `--offset` で分けると、ジョブの合間に日次が作品を足して対象が 1 人増えたときに
 * 境目が丸ごとずれ、どの組にも入らない人が出る。月次は 3 つのジョブに分けて順に走らせるので、
 * その間 (数時間) に対象が動くことを前提にする
 */
export function shardActors(actors: readonly CrawlActor[], shard: Shard | undefined): CrawlActor[] {
  if (shard === undefined) return [...actors];
  return actors.filter((actor) => hashActorId(actor.id) % shard.total === shard.index - 1);
}

/** `--only` の値で絞る。canonicalName と slug のどちらでも書けるようにする */
export function filterActors(
  actors: readonly CrawlActor[],
  only: string | undefined,
): CrawlActor[] {
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
  // --dry-run でも要る。誰を調べるかは台帳 (DB) にしか無いので、読むために接続する
  if (baseUrl === undefined || baseUrl === "") {
    process.stderr.write(`--base-url か環境変数 INGEST_URL が要る\n\n${USAGE}`);
    return 1;
  }
  if (token === undefined || token === "") {
    process.stderr.write("環境変数 INGEST_TOKEN が要る\n");
    return 1;
  }

  const storeOption = asString(values.store);
  if (storeOption !== undefined && !isStoreSlug(storeOption)) {
    process.stderr.write(
      `--store は ${STORE_SLUGS.join(" / ")} のどれかを指定する: ${storeOption}\n`,
    );
    return 1;
  }
  const stores = storeOption === undefined ? ALL_STORES : [storeOption];

  const limitOption = asString(values.limit);
  const limit = limitOption === undefined ? undefined : Number(limitOption);
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    process.stderr.write(`--limit は 1 以上の整数を指定する: ${limitOption}\n`);
    return 1;
  }

  const shardOption = asString(values.shard);
  const shard = parseShard(shardOption);
  if (shardOption !== undefined && shard === undefined) {
    process.stderr.write(`--shard は 1 始まりの i/n の形で指定する: ${shardOption}\n`);
    return 1;
  }

  const offsetOption = asString(values.offset);
  const offset = offsetOption === undefined ? undefined : Number(offsetOption);
  // 0 を許すのは「先頭から」を明示して書けるようにするため (スクリプトで組み立てやすい)
  if (offset !== undefined && (!Number.isInteger(offset) || offset < 0)) {
    process.stderr.write(`--offset は 0 以上の整数を指定する: ${offsetOption}\n`);
    return 1;
  }

  // 台帳を読むだけの走行でも取り込み先が要る。誰を調べるかは DB にしか無い
  const client = new AdminApiClient(baseUrl ?? "", token ?? "");
  const neverCrawled = values["never-crawled"] === true;
  const withWorks = values["with-works"] === true;
  if (neverCrawled && withWorks) {
    process.stderr.write("--never-crawled と --with-works は同時に指定できない\n");
    return 1;
  }
  const all = await loadCrawlActors(client, { neverCrawled, withWorks });
  const what = neverCrawled ? "一度も引いていない声優" : withWorks ? "作品を持つ声優" : "対象声優";
  process.stdout.write(`${what}を台帳から読んだ: ${all.length} 人\n`);
  if ((neverCrawled || withWorks) && all.length === 0) {
    process.stdout.write("対象が 0 人。何もしない\n");
    return 0;
  }

  const filtered = shardActors(filterActors(all, asString(values.only)), shard);
  if (shard !== undefined) {
    process.stdout.write(
      `${shard.total} 組に分けた ${shard.index} 番目を対象にする: ${filtered.length} 人\n`,
    );
  }
  const actors = sliceActors(filtered, offset, limit);
  if (actors.length === 0) {
    process.stderr.write(
      filtered.length === 0
        ? "対象の声優が 0 人。--only か --shard の指定を見直す\n"
        : `対象の声優が 0 人。--offset ${offset} が候補 ${filtered.length} 人を超えている\n`,
    );
    return 1;
  }
  if (offset !== undefined && offset > 0) {
    process.stdout.write(
      `先頭 ${offset} 人を飛ばし、${offset + 1} 人目から ${offset + actors.length} 人目までを対象にする\n`,
    );
  }

  // ポケドラは名前で検索できない (声優はタグで、URL に tag_id が要る)。先に辞書を読む
  const pokedoraDirectory = stores.includes("pokedora") ? await loadPokedoraDirectory() : undefined;
  if (stores.includes("pokedora")) {
    if (pokedoraDirectory === undefined) {
      process.stderr.write(
        "[警告] ポケドラの声優タグ辞書 (crawler/pokedora-tags.generated.json) を読めなかった。" +
          "`node crawler/discovery/build-pokedora-tags.ts` で作る。ポケドラは全員分を飛ばす\n",
      );
    } else {
      process.stdout.write(
        `ポケドラの声優タグ辞書: ${pokedoraDirectory.size} 名 (一般 + BL に作品がある人だけ)\n`,
      );
    }
  }

  // 送らない走行では取り込み先を渡さない。取得だけを試せるようにするため
  const ingestTarget = dryRun ? undefined : client;
  const knownIds = await loadKnownIds(ingestTarget, stores, values["no-skip-known"] === true);
  const runDate = new Date().toISOString().slice(0, 10);
  const snapshot = values["no-snapshot"] !== true;

  const outcomes: RunOutcome[] = [];
  let aborted: string | undefined;
  let index = 0;
  for (const actor of actors) {
    index += 1;
    const forActor: RunOutcome[] = [];
    // searchNames は Audible のためのもの。DLsite adapter は canonicalName しか見ないので
    // ストアを問わず同じ ActorQuery を渡す
    const pokedoraRefs = lookupActor(pokedoraDirectory, actor.canonicalName);
    const query: ActorQuery = {
      canonicalName: actor.canonicalName,
      searchNames: buildSearchNames(actor),
      ...(pokedoraRefs === undefined ? {} : { storeActorRefs: { pokedora: pokedoraRefs } }),
    };
    // 辞書に無い声優のポケドラは引かない。名前から tag_id を引く API が無く
    // (`/sapi/json.php` は 404)、総当たりで探す手段もないため (ストア横断調査 §1-3)
    const actorStores = stores.filter(
      (storeSlug) => storeSlug !== "pokedora" || pokedoraRefs !== undefined,
    );
    const skipped = stores.filter((storeSlug) => !actorStores.includes(storeSlug));
    try {
      for (const storeSlug of actorStores) {
        // 取得を始めた時刻。ストアの間隔を守るので 1 声優でも分単位かかる
        const startedAt = new Date().toISOString();
        const result = await ADAPTERS[storeSlug].fetchByActor(query, {
          skipKnownIds: knownIds.get(storeSlug),
          snapshot,
        });
        for (const warning of result.warnings) {
          process.stderr.write(`[警告] ${actor.canonicalName} ${storeSlug}: ${warning}\n`);
        }
        // ストアが出している声優 ID (ポケドラの tag_id) を貯める。
        // 「同じ tag_id なら同一人物」はストア由来の事実で、別名義の根拠に使える
        await appendActorRefs(result.observedActorRefs ?? []);
        // この走行で詳細まで取った作品を既知に足す。共演の多いストアでは同じ作品が
        // 何人もの一覧に出るので、これが無いと同じ詳細ページを人数分だけ引き直す。
        // ポケドラの BL ドラマ CD は 1 作品に十数名が出るため、延べ 8,593 件のうち
        // かなりが重複になる。credit は作品に紐づいて既に保存されているので、
        // 2 人目以降で詳細を飛ばしても出演者は落ちない (upsert は credit を消さない)
        markFetched(knownIds, storeSlug, result.works);
        forActor.push(await send(ingestTarget, actor, storeSlug, result, runDate, startedAt));
      }
    } catch (error) {
      // 版ずれ。残り全員も確実に同じ結果になるので、ここで打ち切る
      if (!(error instanceof IngestProtocolMismatchError)) throw error;
      aborted = error.message;
      outcomes.push(...forActor);
      break;
    }
    outcomes.push(...forActor);
    process.stdout.write(`${progressLine(index, actors.length, actor, forActor, skipped)}\n`);
  }

  if (aborted !== undefined) {
    // 中断でも、そこまでに何を保存できたかの表は出す。再開の範囲を決める材料になる
    if (outcomes.length > 0) process.stdout.write(`\n${formatOutcomeTable(outcomes)}\n`);
    process.stderr.write(
      `\n[中断] サーバーが payload の版の違いを理由に受け取りを拒否した。\n` +
        `  ${aborted}\n` +
        `  クローラーのプロセスが古いコードのまま動いている。止めて起動し直すこと。\n` +
        `  ${index - 1} 人目まで処理し、残り ${actors.length - index + 1} 人は実行していない。\n` +
        `  再開するには --offset で済んだぶんを飛ばす\n`,
    );
    return 1;
  }

  process.stdout.write(`\n${formatOutcomeTable(outcomes)}\n`);
  const summary = summarize(outcomes);
  // 取得と保存を分けて出す。まとめると、取得できたのに 1 件も保存されていない状態が
  // 「成功」に見えてしまう
  process.stdout.write(
    `\n声優 ${summary.actors} 人 / 取得 ${summary.ok} 成功・${summary.empty} 空・` +
      `${summary.error} 失敗 (作品 ${summary.fetched} 件)\n` +
      `保存 ${summary.saved} 成功・${summary.saveFailed} 失敗 / ` +
      `保存できた作品 ${summary.works} 件 (new ${summary.new}) / ` +
      `未解決クレジット ${summary.unmatched} 件\n`,
  );
  if (summary.delisted > 0) {
    process.stdout.write(`もう買えないと分かった作品 ${summary.delisted} 件 (一覧から落とす)\n`);
  }
  if (summary.incomplete > 0) {
    // 検索の上限に当たった声優。画面ではストアの検索リンクに逃がしているが、
    // 月次で何人がそこに居るかは走行の出力でしか分からない
    process.stdout.write(
      `検索の上限に当たって取り切れなかった 声優×ストア ${summary.incomplete} 件\n`,
    );
  }
  if (summary.saveFailedUnrecorded > 0) {
    process.stdout.write(
      `DB に記録できなかった失敗 ${summary.saveFailedUnrecorded} 件 ` +
        `(crawl_runs に行が無いので、管理画面からは 0 件の声優と区別が付かない)\n`,
    );
  }

  // 取得の失敗と保存の失敗、どちらでも異常終了。ここまで来ている時点で全件の送信は終えている
  return summary.error > 0 || summary.saveFailed > 0 ? 1 : 0;
}

/** 進捗の 1 行。時間のかかる処理なので、声優 1 人が終わるたびに結果が見えるようにする */
function progressLine(
  index: number,
  total: number,
  actor: CrawlActor,
  outcomes: readonly RunOutcome[],
  skippedStores: readonly StoreSlug[] = [],
): string {
  const parts = outcomes.map((outcome) => {
    // 保存に失敗した行は件数ではなく失敗と書く。「0件」と並べて出すと見分けが付かない
    if (outcome.save === "failed") {
      return `${outcome.storeSlug} ${outcome.status} 取得${outcome.fetchedCount}件だが保存失敗`;
    }
    return `${outcome.storeSlug} ${outcome.status} ${outcome.workCount}件(new ${outcome.newCount})`;
  });
  // 引かなかったストアも 1 行に出す。0 件だった声優と見分けが付かなくなるため
  for (const storeSlug of skippedStores) parts.push(`${storeSlug} 辞書に無いので引かない`);
  const position = String(index).padStart(String(total).length);
  return `[${position}/${total}] ${actor.canonicalName}  ${parts.join("  ")}`;
}

/**
 * 取得結果を ingest に送り、集計 1 行にまとめる。
 * 取得に失敗した (`status: "error"`) ときも `error` 付きで送り、crawl_runs に残す。
 *
 * `IngestProtocolMismatchError` だけは捕まえずに投げ直す。クローラーが古いという意味なので、
 * 残りの声優を回しても同じ結果にしかならず、呼び出し側が走行ごと止めるため
 */
export async function send(
  client: AdminApiClient | undefined,
  actor: CrawlActor,
  storeSlug: StoreSlug,
  result: AdapterResult,
  runDate: string,
  /** このストアの取得を始めた時刻。渡さなければサーバーが取り込みを受けた時刻で埋める */
  startedAt?: string,
): Promise<RunOutcome> {
  const base = {
    actor,
    storeSlug,
    status: result.status,
    fetchedCount: result.works.length,
    // 保存できて初めて件数が入る。送る前の時点では 0 にしておく
    workCount: 0,
    newCount: 0,
    unmatchedCount: 0,
    // 取れた作品のうち、ストアが「もう買えない」と示したもの。
    // 詳細を引かなかった作品は判断が付かないので数に入らない
    delistedCount: result.works.filter((work) => work.delisted === true).length,
    ...(result.coverage?.complete === undefined
      ? {}
      : { coverageComplete: result.coverage.complete }),
    ...(result.reason === undefined ? {} : { reason: result.reason }),
    ...(result.queryUsed === undefined ? {} : { queryUsed: result.queryUsed }),
    save: "skipped",
  } satisfies RunOutcome;

  if (client === undefined) return base;

  // 同じ日に流し直すと上書きされる。ingest 側が冪等なので取り込み結果は変わらない
  const runId = `${runDate}-${storeSlug}-${actor.slug}`;
  const payload: IngestPayload = {
    // サーバーと形が揃っているかの検査。合わなければサーバーが 409 を返す
    protocolVersion: INGEST_PROTOCOL_VERSION,
    runId,
    storeSlug,
    voiceActorId: actor.id,
    // 取得を始めた時刻。1 回の走行は数時間に及ぶので、取り込みを受けた時刻とは別に送る
    ...(startedAt === undefined ? {} : { startedAt }),
    works: result.works,
    ...(result.status === "error" && result.reason !== undefined ? { error: result.reason } : {}),
    // 網羅率。総件数を読めなければ `totalCount` は送らず、crawl_runs 側を NULL のままにする。
    // 「不明」と「全部取れた」を混ぜないため。
    // `coverageComplete` は総件数と独立で、取り切れていないことだけが分かる走行
    // (検索先の一部を引けなかった) では総件数抜きで false が送られる
    ...(result.coverage?.total === undefined ? {} : { totalCount: result.coverage.total }),
    ...(result.coverage?.complete === undefined
      ? {}
      : { coverageComplete: result.coverage.complete }),
  };

  try {
    const response = await client.ingest(payload);
    return {
      ...base,
      workCount: response.upserted,
      newCount: response.new,
      unmatchedCount: response.unmatched,
      save: "saved",
    };
  } catch (error) {
    // 版ずれは 1 件の失敗ではなく走行全体の問題。ここで握り潰さず上へ投げる
    if (error instanceof IngestProtocolMismatchError) throw error;

    const reason = error instanceof AdminApiError ? error.message : String(error);
    process.stderr.write(`[エラー] ${actor.canonicalName} ${storeSlug}: ${reason}\n`);
    const failureRecorded = await reportFailure(
      client,
      { runId, storeSlug, actor, ...(startedAt === undefined ? {} : { startedAt }) },
      reason,
    );
    // status は adapter の取得結果のまま残す。取得できたのに保存できなかったのか、
    // そもそも取れなかったのかを後から見分けられるようにするため
    return { ...base, reason, save: "failed", failureRecorded };
  }
}

/**
 * 保存に失敗したことを `crawl_runs` に残す。
 *
 * 作品を外した最小ペイロードを送り直す。元の payload そのものが失敗の原因
 * (大きすぎる / 形が古い) であることがあるので、同じものを送り直しても意味がない。
 *
 * これ自体が失敗することもある (サーバーが落ちている等)。そのときは false を返し、
 * 「DB に記録できなかった失敗」として最終集計に出す。ここで投げると、
 * 記録できなかったという事実ごと失われてしまう
 */
async function reportFailure(
  client: AdminApiClient,
  source: { runId: string; storeSlug: StoreSlug; actor: CrawlActor; startedAt?: string },
  reason: string,
): Promise<boolean> {
  try {
    await client.ingest(
      failureReport(
        {
          runId: source.runId,
          storeSlug: source.storeSlug,
          voiceActorId: source.actor.id,
          ...(source.startedAt === undefined ? {} : { startedAt: source.startedAt }),
        },
        reason,
      ),
    );
    return true;
  } catch (error) {
    // 版ずれなら呼び出し元が走行を止める。ここで握り潰すと止まらなくなる
    if (error instanceof IngestProtocolMismatchError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `[エラー] ${source.actor.canonicalName} ${source.storeSlug}: ` +
        `失敗を crawl_runs に記録できなかった: ${detail}\n`,
    );
    return false;
  }
}

/**
 * ストアごとの既知 ID。DLsite の `product.json` を新規 ID だけに絞るために使う。
 * 取れなくても致命的ではない (全件取り直しになるだけ) ので、失敗しても警告に留める。
 *
 * 走行中に取った作品もここに足していく (`markFetched`) ので、Set は書き換えられる形で返す
 */
async function loadKnownIds(
  client: AdminApiClient | undefined,
  stores: readonly StoreSlug[],
  disabled: boolean,
): Promise<Map<StoreSlug, Set<string>>> {
  const known = new Map<StoreSlug, Set<string>>();
  if (client === undefined || disabled) return known;

  for (const storeSlug of stores) {
    try {
      const ids = await client.knownIds(storeSlug);
      known.set(storeSlug, new Set(ids));
      process.stdout.write(`既知の ${storeSlug} 作品: ${ids.size} 件 (詳細取得を飛ばす)\n`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[警告] known-ids (${storeSlug}) を取れなかった: ${reason}\n`);
      // 空でも集合は置く。DB 側の既知 ID は使えないが、この走行の中での重複取得は止められる
      known.set(storeSlug, new Set());
    }
  }
  return known;
}

/**
 * 取り終えた作品を既知集合に足す。1 作品に十数名が出る BL ドラマ CD で、同じ詳細ページを
 * 出演者の人数ぶん引き直さないため。credit は作品に紐づいて保存済みなので、2 人目以降で
 * 詳細を飛ばしても出演者は落ちない。
 *
 * `--no-skip-known` を指定した走行では `knownIds` に集合そのものが無いので何もしない。
 * 「毎回すべて取り直す」という指定を、走行の途中から勝手に外さないため
 */
export function markFetched(
  knownIds: Map<StoreSlug, Set<string>>,
  storeSlug: StoreSlug,
  works: readonly { storeProductId: string }[],
): void {
  const known = knownIds.get(storeSlug);
  if (known === undefined) return;
  for (const work of works) known.add(work.storeProductId);
}

// 直接実行されたときだけ動かす (テストから import しても main が走らないようにするため)
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
