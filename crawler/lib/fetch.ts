import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { SNAPSHOT_DIR, safeFileName } from "./paths.ts";

/**
 * 外部サイトへの唯一の fetch 入口。
 * ここに UA・レート制限・スナップショット保存・タイムアウト・リトライを集約し、
 * adapter からは素の `fetch` を呼ばせない。相手サイトへの負荷を 1 箇所で制御するため
 */

/** ブラウザ相当の UA。スクレイパー判定で 302 に飛ばされるのを避ける */
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/141.0.0.0 Safari/537.36";

/**
 * Wikimedia 向けの自己申告 UA。ここだけ他のホストと要求が逆で、ブラウザの UA を名乗ることが
 * User-Agent policy で禁じられている (docs/stores/wikimedia.md の「既知の落とし穴」)。
 * 形式と連絡先は同じ節の `<クライアント名> (<連絡先>)` に合わせ、"bot" を名前に入れる
 */
const WIKIMEDIA_USER_AGENT =
  "va-audio-release-radar-bot (https://github.com/m4tsu/va-audio-release-radar)";

/**
 * Wikimedia が運営するドメイン。サブドメイン (ja.wikipedia.org / www.wikidata.org /
 * dumps.wikimedia.org など) も含めて自己申告 UA に振り分ける。
 * 同じ policy が Wikimedia の全サイトに及ぶので、プロジェクトのドメインをまとめて並べる
 */
const WIKIMEDIA_DOMAINS = [
  "wikipedia.org",
  "wikidata.org",
  "wikimedia.org",
  "wiktionary.org",
  "wikibooks.org",
  "wikiquote.org",
  "wikisource.org",
  "wikinews.org",
  "wikiversity.org",
  "wikivoyage.org",
  "wikifunctions.org",
  "mediawiki.org",
] as const;

/**
 * このホストに名乗る UA。Wikimedia だけ自己申告の UA を送り、他は今までどおりブラウザ相当を送る。
 * 振り分けをホスト名で行うのは、UA の要求が相手サイトごとに違い、呼び出し側の指定に委ねると
 * 書き漏らしたところだけ policy 違反になるため
 */
export function userAgentFor(rawUrl: string): string {
  const host = new URL(rawUrl).hostname;
  const isWikimedia = WIKIMEDIA_DOMAINS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
  return isWikimedia ? WIKIMEDIA_USER_AGENT : BROWSER_USER_AGENT;
}

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

/** "binary" は gzip など文字列に直せない本文を取るときに使う (ポケドラの sitemap `.xml.gz`) */
export type FetchKind = "html" | "json" | "binary";

export type FetchSuccess = {
  ok: true;
  status: number;
  url: string;
  /** kind が "binary" のときは空文字。本体は `bytes` に入る */
  body: string;
  /** kind が "binary" のときだけ入る生バイト列 */
  bytes?: Uint8Array;
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
 *。全声優のクロールはその分長くなるが、それは意図どおり。
 *
 * Audible は連続アクセスで 302 に飛ばされた実績があるため 6 秒
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
  // ポケドラの robots.txt は `Disallow: /cart/*` と `/mypage/*` だけで Crawl-delay の指定が無い。
  // 指定が無いときに何秒が妥当かは相手にしか分からないので、こちらで保守的に 5 秒を採る。
  // 声優タグ辞書は 3,161 件の一度きりのバッチで、速く終わらせる必要がない
  if (host === "pokedora.com" || host.endsWith(".pokedora.com")) {
    return { key: "pokedora", intervalMs: 5_000 };
  }
  // AniList は 1 分あたりのリクエスト上限があり、超えると 429 + Retry-After を返す。
  // 公称は 90 req/min だが、2026-09-19 時点は API が劣化状態で 30 req/min に制限されている
  // (docs.anilist.co/guide/rate-limiting の記載、実測ヘッダ x-ratelimit-limit: 30 の両方で確認)。
  // 90 req/min は平常時の値であって今の実効値ではないので、それを根拠に間隔を詰めない。
  // 上限 30 に対し、閾値非公開のバースト制限の余地も残して 3.0 秒 (= 20 req/min) にする。
  // 詳細は docs/stores/anilist.md の「レート間隔」。上限が 90 req/min に戻ったら間隔を見直すこと
  if (host === "graphql.anilist.co") {
    return { key: "anilist", intervalMs: 3_000 };
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
      // 飛び先そのものが結果の意味を持つことがあるため、判定は呼び出し側に委ねる
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      ...(options.body === undefined ? {} : { body: options.body }),
      headers: {
        "User-Agent": userAgentFor(rawUrl),
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

  // gzip は文字列に落とすと壊れるので、binary だけはバイト列のまま返す。
  // text() の文字コード判定 (Content-Type の charset) は html / json ではそのまま使いたいので、
  // 全部をバイト列経由にはしない
  try {
    if (options.kind === "binary") {
      const bytes = new Uint8Array(await response.arrayBuffer());
      return { ok: true, status: response.status, url: rawUrl, body: "", bytes };
    }
    return { ok: true, status: response.status, url: rawUrl, body: await response.text() };
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return { ok: false, url: rawUrl, status: response.status, reason, retryable: true };
  }
}

/**
 * 外部サイトの取得。kind が "binary" のときは `bytes` に、それ以外は `body` に本文が入る。
 * 名前は履歴上 fetchText のままにしてある (呼び出し側が多く、改名の実利がないため)
 */
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

  const snapshotPath = await saveSnapshot(last, options);
  return snapshotPath === undefined ? last : { ...last, snapshotPath };
}

/** 取得した生データを残す。パーサーが壊れたときに再現できるようにするため */
async function saveSnapshot(
  result: FetchSuccess,
  options: FetchOptions,
): Promise<string | undefined> {
  if (options.snapshot === false) return undefined;
  const dir = path.join(SNAPSHOT_DIR, safeFileName(options.store));
  // binary の中身は gzip などなので、テキストとして開かせないよう拡張子を分ける
  const extension = options.kind === "binary" ? "bin" : options.kind;
  const file = path.join(dir, `${safeFileName(options.requestKey)}.${extension}`);
  await mkdir(dir, { recursive: true });
  await writeFile(file, result.bytes ?? result.body);
  return file;
}
