import type { IngestPayload, StoreSlug } from "../../src/domain/index.ts";

/**
 * Worker 側の管理 API (`/api/admin/*`) を叩くクライアント (設計書 §2 / §6)。
 *
 * ここは `lib/fetch.ts` を通さない。あちらは外部ストアへの負荷を抑えるためのレート制限を
 * 持っており、自前の API に効かせると 1 声優ごとに無駄な待ちが入る。相手は自分たちの
 * サーバーなので、UA 偽装もスナップショット保存も要らない
 */

const TIMEOUT_MS = 60_000;
/**
 * 試行ごとの待ち時間 (先頭は待たない)。合計 3 回・最大 40 秒待つ。
 * 相手は自前のサーバーなので連打を避けるほどの配慮は要らないが、再起動が終わるだけの猶予は置く
 */
const RETRY_DELAYS_MS = [0, 5_000, 30_000] as const;

/** `POST /api/admin/ingest` の応答 (src/server/queries/ingest.ts の IngestResult と同じ形) */
export type IngestResponse = {
  upserted: number;
  new: number;
  unmatched: number;
  skippedAdult: number;
};

export type UpsertActorsResponse = { actors: number; aliases: number };

/** `crawler/actors.json` の 1 件。検証そのものはサーバー側の zod に任せる */
export type ActorSeed = {
  id: string;
  slug: string;
  canonicalName: string;
  nameKana?: string;
  anilistStaffId?: number;
  aliases?: Array<{ name: string; source: string; verified: boolean }>;
};

/**
 * 検証済みの空白入り alias 名を、`actors.json` に書かれた順番のまま返す (T8)。
 * Audible はナレーター検索が空白の有無で結果が変わる名前があるため、
 * `crawler/run.ts` と `crawler/cli.ts` がこれを検索候補の先頭に置く
 */
export function spacedVerifiedAliasNames(actor: Pick<ActorSeed, "aliases">): string[] {
  return spacedAliasNames(actor, true);
}

/**
 * 未検証の空白入り alias 名 (T13)。自動生成のリストは「姓を 2 文字で切った形」と
 * 「3 文字で切った形」を当てずっぽうで持っているので、検証済みとは分けて扱う。
 * `crawler/run.ts` はこれを canonicalName より後ろの候補に置く
 */
export function spacedUnverifiedAliasNames(actor: Pick<ActorSeed, "aliases">): string[] {
  return spacedAliasNames(actor, false);
}

function spacedAliasNames(actor: Pick<ActorSeed, "aliases">, verified: boolean): string[] {
  return (actor.aliases ?? [])
    .filter((alias) => alias.verified === verified && /\s/.test(alias.name))
    .map((alias) => alias.name);
}

export class AdminApiError extends Error {}

export class AdminApiClient {
  readonly #baseUrl: string;
  readonly #token: string;

  constructor(baseUrl: string, token: string) {
    // 末尾のスラッシュを落としてから結合する。`http://localhost:5199/` でも動かすため
    this.#baseUrl = baseUrl.replace(/\/+$/, "");
    this.#token = token;
  }

  upsertActors(seeds: readonly ActorSeed[]): Promise<UpsertActorsResponse> {
    return this.#send<UpsertActorsResponse>("POST", "/api/admin/actors", seeds);
  }

  ingest(payload: IngestPayload): Promise<IngestResponse> {
    return this.#send<IngestResponse>("POST", "/api/admin/ingest", payload);
  }

  /** 既に DB にある商品 ID。DLsite の詳細取得を新規だけに絞るために使う */
  async knownIds(storeSlug: StoreSlug): Promise<Set<string>> {
    const ids = await this.#send<unknown>("GET", `/api/admin/known-ids?store=${storeSlug}`);
    if (!Array.isArray(ids)) throw new AdminApiError("known-ids が配列を返さなかった");
    return new Set(ids.filter((id): id is string => typeof id === "string"));
  }

  async #send<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const url = `${this.#baseUrl}${path}`;
    const response = await this.#sendWithRetry(method, url, path, body);

    const text = await response.text();
    if (!response.ok) {
      // 本文には zod の issue 一覧が入ることがあるので、切り詰めたうえでそのまま見せる
      throw new AdminApiError(
        `${method} ${path} が HTTP ${response.status}: ${text.slice(0, 500)}`,
      );
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new AdminApiError(`${method} ${path} の応答が JSON ではない: ${text.slice(0, 200)}`);
    }
  }

  /**
   * 到達できない場合と 5xx をやり直す。1 回の実行は 40 分を超えるので、その間に取り込み先が
   * 再起動したりコールドスタートしたりすることがある。ここで諦めると、取得済みの結果を
   * 捨てて再クロールし直す羽目になる (相手サイトへの負荷も二重になる)。
   * 4xx はやり直しても同じなので即座に返す
   */
  async #sendWithRetry(
    method: "GET" | "POST",
    url: string,
    path: string,
    body: unknown,
  ): Promise<Response> {
    let lastReason = "";
    for (const [attempt, delayMs] of RETRY_DELAYS_MS.entries()) {
      if (attempt > 0) await sleep(delayMs);
      try {
        const response = await this.#request(method, url, body);
        if (response.status < 500) return response;
        lastReason = `HTTP ${response.status}`;
      } catch (error) {
        lastReason = describe(error);
      }
    }
    throw new AdminApiError(`${method} ${path} に到達できない: ${lastReason}`);
  }

  #request(method: string, url: string, body: unknown): Promise<Response> {
    return fetch(url, {
      method,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${this.#token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
