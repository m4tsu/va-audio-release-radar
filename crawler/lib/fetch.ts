import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { SNAPSHOT_DIR, safeFileName } from "./paths.ts";

/**
 * 外部サイトへの唯一の fetch 入口 (設計書 §8)。
 * ここに UA・レート制限・スナップショット保存・タイムアウト・リトライを集約し、
 * adapter からは素の `fetch` を呼ばせない。相手サイトへの負荷を 1 箇所で制御するため
 */

/** ブラウザ相当の UA。スクレイパー判定で 302 に飛ばされるのを避ける (設計書 §3 の Audible) */
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/141.0.0.0 Safari/537.36";

const TIMEOUT_MS = 30_000;
/** リトライ前に待つ時間。相手に連打しないため */
const RETRY_DELAY_MS = 3_000;
/** リトライ回数の上限。429 で待ち直す回数もここに含める */
const MAX_RETRIES = 4;
const TOO_MANY_REQUESTS = 429;
/** 429 なのに Retry-After が無いときの待ち時間。AniList の枠は 1 分単位なので 60 秒 */
const DEFAULT_RATE_LIMITED_DELAY_MS = 60_000;
/** Retry-After が極端な値でも待ちすぎないための上限 */
const MAX_RETRY_AFTER_MS = 120_000;

export type FetchKind = "html" | "json";

export type FetchSuccess = {
  ok: true;
  status: number;
  url: string;
  body: string;
  /** 保存したスナップショットのパス (--no-snapshot 時は undefined) */
  snapshotPath?: string;
};

export type FetchFailure = {
  ok: false;
  url: string;
  /** HTTP ステータス。ネットワークエラー・タイムアウトでは undefined */
  status?: number;
  /** 3xx のときの Location ヘッダ。飛ばされた先で理由を見分けるため (Audible の該当なし判定) */
  location?: string;
  reason: string;
};

export type FetchResult = FetchSuccess | FetchFailure;

export type FetchOptions = {
  /** スナップショットの保存先サブディレクトリ ("dlsite" / "audible") */
  store: string;
  /** スナップショットのファイル名のもと。どの呼び出しかを人が識別できる文字列 */
  requestKey: string;
  kind: FetchKind;
  /** false でスナップショット保存を止める (CLI の --no-snapshot) */
  snapshot?: boolean;
  /** 既定は GET。AniList の GraphQL だけが POST を使う */
  method?: "GET" | "POST";
  /** POST の本文。指定したときは `contentType` も必ず渡す */
  body?: string;
  /** POST 本文の Content-Type */
  contentType?: string;
};

// --- レートリミッタ --------------------------------------------------------

/**
 * キーごとの「次に投げてよい時刻」。await の前に同期的に予約を書き込むので、
 * 同じキーへ並行に呼んでも間隔が詰まらない
 */
const nextAllowedAt = new Map<string, number>();

type RateLimit = { key: string; intervalMs: number };

/**
 * DLsite の robots.txt は `User-agent: *` グループに `Crawl-delay: 10` を置いている。
 * このグループにはパスの限定が無いので、検索 HTML だけでなく `/home/api/=/product.json` を
 * 含む**すべてのパス**に及ぶ。以前は product.json を「負荷の軽い API」とみなして 2 秒に
 * していたが、それは相手の指定より短く、こちらの都合でしかなかった。1 つのキーで 10 秒に揃える
 * (設計書 §13)。全声優のクロールはその分長くなるが、それは意図どおり。
 *
 * Audible は連続アクセスで 302 に飛ばされた実績があるため 6 秒 (設計書 §3)
 */
export function rateLimitFor(rawUrl: string): RateLimit {
  const url = new URL(rawUrl);
  const host = url.hostname;
  if (host === "dlsite.com" || host.endsWith(".dlsite.com")) {
    return { key: "dlsite", intervalMs: 10_000 };
  }
  if (host === "audible.co.jp" || host.endsWith(".audible.co.jp")) {
    return { key: "audible", intervalMs: 6_000 };
  }
  // AniList は 1 分あたりのリクエスト上限があり、超えると 429 + Retry-After を返す。
  // 公称 90 req/min に対し余裕を取って 1.5 秒 (= 40 req/min) にする
  if (host === "graphql.anilist.co") {
    return { key: "anilist", intervalMs: 1_500 };
  }
  // 未知のホストにも間隔を入れる。設定漏れで連打するより遅いほうが安全
  return { key: host, intervalMs: 5_000 };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 次のスロットを予約し、その時刻まで待つ */
async function acquireSlot(rawUrl: string): Promise<void> {
  const { key, intervalMs } = rateLimitFor(rawUrl);
  const now = Date.now();
  const earliest = Math.max(now, nextAllowedAt.get(key) ?? 0);
  nextAllowedAt.set(key, earliest + intervalMs);
  const waitMs = earliest - now;
  if (waitMs > 0) await sleep(waitMs);
}

// --- 本体 ------------------------------------------------------------------

type Attempt = FetchSuccess | (FetchFailure & { retryable: boolean; retryAfterMs?: number });

/**
 * 429 の `Retry-After` を待ち時間に直す。秒数か HTTP-date のどちらかで来る。
 * 読めなければ undefined を返し、呼び出し側の既定値を使わせる
 */
export function parseRetryAfterMs(
  header: string | null,
  now: number = Date.now(),
): number | undefined {
  if (header === null) return undefined;
  const trimmed = header.trim();
  if (trimmed === "") return undefined;
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1_000;
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  // 過去日時が来たら 0 に丸める (負の待ち時間にしない)
  return Math.max(0, date - now);
}

async function attempt(rawUrl: string, options: FetchOptions): Promise<Attempt> {
  await acquireSlot(rawUrl);

  const method = options.method ?? "GET";
  let response: Response;
  try {
    response = await fetch(rawUrl, {
      method,
      // リダイレクトは追わない。Audible の /no-search-results への 302 のように、
      // 飛び先そのものが結果の意味を持つことがあるため、判定は呼び出し側に委ねる (設計書 §3)
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      ...(options.body === undefined ? {} : { body: options.body }),
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "ja-JP,ja;q=0.9",
        Accept:
          options.kind === "json"
            ? "application/json, text/plain, */*"
            : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...(options.contentType === undefined ? {} : { "Content-Type": options.contentType }),
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    // ネットワークエラーとタイムアウトは一時的なことがあるのでリトライ対象
    return { ok: false, url: rawUrl, reason, retryable: true };
  }

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    return {
      ok: false,
      url: rawUrl,
      status: response.status,
      // 呼び出し側が飛び先で意味を判定できるよう、文字列に畳む前の値も渡す
      ...(location === null ? {} : { location }),
      reason: `リダイレクト (${response.status}) → ${location ?? "(Location ヘッダなし)"}`,
      retryable: false,
    };
  }

  if (!response.ok) {
    // 429 は「今は多すぎる」であって恒久的な失敗ではないので、Retry-After に従って待ち直す
    const retryAfterMs =
      response.status === TOO_MANY_REQUESTS
        ? parseRetryAfterMs(response.headers.get("retry-after"))
        : undefined;
    return {
      ok: false,
      url: rawUrl,
      status: response.status,
      reason: `HTTP ${response.status} ${response.statusText}`,
      // 4xx は投げ直しても同じなので、5xx と 429 だけリトライする
      retryable: response.status >= 500 || response.status === TOO_MANY_REQUESTS,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    };
  }

  let body: string;
  try {
    body = await response.text();
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return { ok: false, url: rawUrl, status: response.status, reason, retryable: true };
  }

  return { ok: true, status: response.status, url: rawUrl, body };
}

export async function fetchText(rawUrl: string, options: FetchOptions): Promise<FetchResult> {
  let last = await attempt(rawUrl, options);
  // 429 は待てば通る見込みがあるので、通常の 1 回より多く粘る。
  // 上限を置くのは、相手が延々 429 を返し続けたときに走り続けないようにするため
  let remaining = MAX_RETRIES;
  while (!last.ok && last.retryable && remaining > 0) {
    remaining -= 1;
    const waitMs =
      last.status === TOO_MANY_REQUESTS
        ? Math.min(last.retryAfterMs ?? DEFAULT_RATE_LIMITED_DELAY_MS, MAX_RETRY_AFTER_MS)
        : RETRY_DELAY_MS;
    if (last.status === TOO_MANY_REQUESTS) {
      console.warn(`  429 を受けたので ${Math.round(waitMs / 1000)} 秒待って再試行: ${rawUrl}`);
    }
    await sleep(waitMs);
    last = await attempt(rawUrl, options);
  }

  if (!last.ok) {
    const { retryable: _retryable, ...failure } = last;
    return failure;
  }

  const snapshotPath = await saveSnapshot(last.body, options);
  return snapshotPath === undefined ? last : { ...last, snapshotPath };
}

/** 取得した生データを残す。パーサーが壊れたときに再現できるようにするため (企画書 §20) */
async function saveSnapshot(body: string, options: FetchOptions): Promise<string | undefined> {
  if (options.snapshot === false) return undefined;
  const dir = path.join(SNAPSHOT_DIR, safeFileName(options.store));
  const file = path.join(dir, `${safeFileName(options.requestKey)}.${options.kind}`);
  await mkdir(dir, { recursive: true });
  await writeFile(file, body, "utf8");
  return file;
}
