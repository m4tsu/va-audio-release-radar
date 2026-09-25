import {
  type ActorAttributeSeed,
  type ActorDictionaryEntry,
  type ActorKanaResult,
  type AdminEndpoint,
  type AdminQuery,
  type AdminRequest,
  type AdminResponse,
  type AniListIngestPayload,
  type Delisting,
  INGEST_PROTOCOL_VERSION,
  type IngestPayload,
} from "../../src/contract/index.ts";
import {
  type StoreSlug,
  VOICE_ACTOR_GENDERS,
  type VoiceActorGender,
} from "../../src/domain/index.ts";

/**
 * Worker 側の管理 API (`/api/admin/*`) を叩くクライアント。
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

/**
 * 走行が声優を指すのに要る最小限。誰を調べて、どの名前で検索するかだけを持つ。
 * 辞書 (`GET /api/admin/actors`) の 1 件と同じ形で、別名義を持たない声優は `aliases` を省ける
 */
export type CrawlActor = Omit<ActorDictionaryEntry, "aliases"> &
  Partial<Pick<ActorDictionaryEntry, "aliases">>;

/** 性別の日本語表記。クローラーの標準出力にだけ出る (画面には出さない) */
const GENDER_LABELS: Record<VoiceActorGender, string> = {
  female: "女性",
  male: "男性",
  other: "それ以外",
  unknown: "不明",
};

/**
 * 性別の内訳を 1 行にする。「女性 1 人 / 男性 2 人 / それ以外 0 人 / 不明 3 人」。
 *
 * 0 人の区分も省かずに出す。省くと、取れていない (全員が不明) のか
 * 該当が居ないだけなのかが出力から読めなくなる
 */
export function describeGenderCounts(actors: readonly { gender?: VoiceActorGender }[]): string {
  const counts: Record<VoiceActorGender, number> = { female: 0, male: 0, other: 0, unknown: 0 };
  for (const actor of actors) {
    // 声優リストは JSON をそのまま読むので、列挙に無い値が混じりうる。
    // そのまま数えると合計が人数と合わなくなり、内訳を出す意味が無くなる
    const gender = actor.gender;
    counts[gender !== undefined && VOICE_ACTOR_GENDERS.includes(gender) ? gender : "unknown"] += 1;
  }
  return VOICE_ACTOR_GENDERS.map((gender) => `${GENDER_LABELS[gender]} ${counts[gender]} 人`).join(
    " / ",
  );
}

/**
 * 検証済みの空白入り alias 名を、リストに書かれた順番のまま返す。
 * Audible はナレーター検索が空白の有無で結果が変わる名前があるため、
 * `crawler/run.ts` と `crawler/cli.ts` がこれを検索候補の先頭に置く
 */
export function spacedVerifiedAliasNames(actor: Pick<CrawlActor, "aliases">): string[] {
  return spacedAliasNames(actor, true);
}

/**
 * 未検証の空白入り alias 名。自動生成のリストは「姓を 2 文字で切った形」と
 * 「3 文字で切った形」を当てずっぽうで持っているので、検証済みとは分けて扱う。
 * `crawler/run.ts` はこれを canonicalName より後ろの候補に置く
 */
export function spacedUnverifiedAliasNames(actor: Pick<CrawlActor, "aliases">): string[] {
  return spacedAliasNames(actor, false);
}

function spacedAliasNames(actor: Pick<CrawlActor, "aliases">, verified: boolean): string[] {
  return (actor.aliases ?? [])
    .filter((alias) => alias.verified === verified && /\s/.test(alias.name))
    .map((alias) => alias.name);
}

export class AdminApiError extends Error {}

/**
 * サーバーが 409 を返した、つまり送っている payload の形が古い。
 *
 * `AdminApiError` と分けてあるのは、呼び出し側の扱いが違うため。ふつうの失敗は
 * その 1 件を失敗として記録して次の声優に進むが、これは残り全員も確実に同じ結果になる。
 * 取得済みの結果を丸ごと捨てないよう、受け取ったら走行ごと止める
 */
export class IngestProtocolMismatchError extends AdminApiError {}

/**
 * ingest に送れなかったことを記録するための最小ペイロード。
 *
 * 取り込み本体が失敗したときに、作品を外して `error` だけを付けて送り直す。
 * これを送らないと `crawl_runs` に行が 1 つも残らず、管理画面からは
 * 「作品が 0 件だった声優」と区別が付かない。works を空にするのは、
 * 元の payload が大きすぎる / 形が不正なことこそが失敗の原因でありうるため
 */
export function failureReport(
  source: Pick<IngestPayload, "runId" | "storeSlug" | "voiceActorId" | "startedAt">,
  error: string,
): IngestPayload {
  return {
    protocolVersion: INGEST_PROTOCOL_VERSION,
    runId: source.runId,
    storeSlug: source.storeSlug,
    voiceActorId: source.voiceActorId,
    // 失敗した走行でも取得を始めた時刻は成功時と同じ意味にする
    ...(source.startedAt === undefined ? {} : { startedAt: source.startedAt }),
    works: [],
    // 管理画面にそのまま出る 1 行なので、長い zod の issue 一覧は切り詰める
    error: error.slice(0, 500),
  };
}

export class AdminApiClient {
  readonly #baseUrl: string;
  readonly #token: string;

  constructor(baseUrl: string, token: string) {
    // 末尾のスラッシュを落としてから結合する。`http://localhost:5199/` でも動かすため
    this.#baseUrl = baseUrl.replace(/\/+$/, "");
    this.#token = token;
  }

  /**
   * 声優起点の走行が「誰を調べるか」を引く辞書。台帳は DB にしかないので、
   * リストをファイルで配らない。`neverCrawled` は一度も引いていない声優、
   * `withWorks` は作品を持つ声優だけに絞る
   */
  async listActors(
    options: { neverCrawled?: boolean; withWorks?: boolean } = {},
  ): Promise<AdminResponse<"GET /api/admin/actors">> {
    const entries = await this.#send("GET /api/admin/actors", {
      "never-crawled": options.neverCrawled,
      "with-works": options.withWorks,
    });
    if (!Array.isArray(entries)) throw new AdminApiError("actors が配列を返さなかった");
    return entries;
  }

  /** AniList の取得 1 回ぶん。声優の ID と slug はサーバーが決めて応答で返す */
  ingestAniList(payload: AniListIngestPayload): Promise<AdminResponse<"POST /api/admin/anilist">> {
    return this.#send("POST /api/admin/anilist", payload);
  }

  /** かなをまだ引いていない声優。古い順に返る */
  async listActorsNeedingKana(limit: number): Promise<AdminResponse<"GET /api/admin/actor-kana">> {
    const targets = await this.#send("GET /api/admin/actor-kana", { limit });
    if (!Array.isArray(targets)) throw new AdminApiError("actor-kana が配列を返さなかった");
    return targets;
  }

  /** かなの取得結果。取れなかった人も送ると、引いた印だけが付く */
  writeActorKana(
    results: readonly ActorKanaResult[],
  ): Promise<AdminResponse<"POST /api/admin/actor-kana">> {
    return this.#send("POST /api/admin/actor-kana", [...results]);
  }

  /**
   * 販売終了の判定を書く。台帳が持っている商品を引き直した結果だけを送る。
   *
   * 声優起点の走行ではここを埋められない。ストアの検索結果には売っている作品しか
   * 出ないので、買えなくなった作品は検索から消える (`crawler/delist.ts`)
   */
  recordDelistings(
    items: readonly Delisting[],
  ): Promise<AdminResponse<"POST /api/admin/delistings">> {
    return this.#send("POST /api/admin/delistings", [...items]);
  }

  /** 付加情報 (かな、表示用ローマ字) を出どころ付きで書く */
  writeActorAttributes(
    seeds: readonly ActorAttributeSeed[],
  ): Promise<AdminResponse<"POST /api/admin/actor-attributes">> {
    return this.#send("POST /api/admin/actor-attributes", [...seeds]);
  }

  ingest(payload: IngestPayload): Promise<AdminResponse<"POST /api/admin/ingest">> {
    return this.#send("POST /api/admin/ingest", payload);
  }

  /**
   * 詳細取得を省いてよい商品 ID。
   *
   * 既定は「DB にある作品」だけ。`includeScreened` を立てると「見たが対象声優が
   * 居なかった作品」も混ざる。混ぜてよいのは日次の走行だけで、声優起点は対象声優が
   * 居なくても保存するので、混ぜると一覧の情報だけで保存してしまう
   */
  async knownIds(storeSlug: StoreSlug, includeScreened = false): Promise<Set<string>> {
    const ids = await this.#send("GET /api/admin/known-ids", {
      store: storeSlug,
      screened: includeScreened,
    });
    if (!Array.isArray(ids)) throw new AdminApiError("known-ids が配列を返さなかった");
    return new Set(ids.filter((id): id is string => typeof id === "string"));
  }

  /**
   * 呼べるのは `AdminApi` にあるエンドポイントだけ。送る形と受け取る形もそこから決まるので、
   * サーバーの検証と違う形をここで組むと型検査で落ちる
   */
  async #send<K extends AdminEndpoint>(
    endpoint: K,
    request: AdminRequest<K>,
  ): Promise<AdminResponse<K>> {
    const [method, route] = splitEndpoint(endpoint);
    const path = method === "GET" ? `${route}${toQueryString(request as AdminQuery)}` : route;
    const url = `${this.#baseUrl}${path}`;
    const response = await this.#sendWithRetry(
      method,
      url,
      path,
      method === "POST" ? request : undefined,
    );

    const text = await response.text();
    if (!response.ok) {
      const detail = `${method} ${path} が HTTP ${response.status}: ${text.slice(0, 500)}`;
      // 409 は「クローラーが古い」の合図。呼び出し側が走行ごと止められるよう型で区別する
      if (response.status === 409) throw new IngestProtocolMismatchError(detail);
      // 本文には zod の issue 一覧が入ることがあるので、切り詰めたうえでそのまま見せる
      throw new AdminApiError(detail);
    }
    try {
      return JSON.parse(text) as AdminResponse<K>;
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

function splitEndpoint(endpoint: AdminEndpoint): ["GET" | "POST", string] {
  const [method, route] = endpoint.split(" ");
  return [method === "GET" ? "GET" : "POST", route ?? ""];
}

/** 真偽は true のときだけ `=1` で載せる。受け手は `=== "1"` で読むので、false を載せても意味が無い */
function toQueryString(query: AdminQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === false) continue;
    params.set(key, value === true ? "1" : String(value));
  }
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
