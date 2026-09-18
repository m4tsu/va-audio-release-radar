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
/** リトライは 1 回だけ。相手に連打しないよう、再試行前にこれだけ待つ */
const RETRY_DELAY_MS = 3_000;

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
};

// --- レートリミッタ --------------------------------------------------------

/**
 * キーごとの「次に投げてよい時刻」。await の前に同期的に予約を書き込むので、
 * 同じキーへ並行に呼んでも間隔が詰まらない
 */
const nextAllowedAt = new Map<string, number>();

type RateLimit = { key: string; intervalMs: number };

/**
 * DLsite の robots.txt は Crawl-delay: 10。検索 HTML はこれに合わせる。
 * product.json は 1 作品ごとに叩くため間隔 10 秒では現実的でなく、負荷の軽い API として 2 秒。
 * Audible は連続アクセスで 302 に飛ばされた実績があるため 6 秒 (設計書 §3)
 */
export function rateLimitFor(rawUrl: string): RateLimit {
  const url = new URL(rawUrl);
  const host = url.hostname;
  if (host === "dlsite.com" || host.endsWith(".dlsite.com")) {
    if (url.pathname.includes("/api/")) return { key: "dlsite:api", intervalMs: 2_000 };
    return { key: "dlsite:html", intervalMs: 10_000 };
  }
  if (host === "audible.co.jp" || host.endsWith(".audible.co.jp")) {
    return { key: "audible", intervalMs: 6_000 };
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

type Attempt = FetchSuccess | (FetchFailure & { retryable: boolean });

async function attempt(rawUrl: string, options: FetchOptions): Promise<Attempt> {
  await acquireSlot(rawUrl);

  let response: Response;
  try {
    response = await fetch(rawUrl, {
      // リダイレクトは追わない。Audible の /no-search-results への 302 のように、
      // 飛び先そのものが結果の意味を持つことがあるため、判定は呼び出し側に委ねる (設計書 §3)
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "ja-JP,ja;q=0.9",
        Accept:
          options.kind === "json"
            ? "application/json, text/plain, */*"
            : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
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
    return {
      ok: false,
      url: rawUrl,
      status: response.status,
      reason: `HTTP ${response.status} ${response.statusText}`,
      // 4xx は投げ直しても同じなので、5xx だけリトライする
      retryable: response.status >= 500,
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
  if (!last.ok && last.retryable) {
    await sleep(RETRY_DELAY_MS);
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
