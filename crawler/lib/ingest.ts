import {
  type AnimeFormat,
  type AnimeRole,
  type AnimeSeason,
  type AttributeSource,
  INGEST_PROTOCOL_VERSION,
  type IngestPayload,
  type StoreSlug,
  VOICE_ACTOR_GENDERS,
  type VoiceActorAttribute,
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

/** `POST /api/admin/ingest` の応答 (src/server/queries/ingest.ts の IngestResult と同じ形) */
export type IngestResponse = {
  upserted: number;
  new: number;
  unmatched: number;
  skippedByRating: number;
  /** 対象声優が 1 人も出ていないとして捨てた作品数 (新着一覧の走行だけ) */
  skippedByNoTargetActor: number;
};

export type UpsertActorsResponse = {
  actors: number;
  aliases: number;
  /**
   * 辞書が増えたので捨てた「対象外」の判断の数。
   * 次の日次は、捨てたぶんの詳細を引き直す (`src/server/queries/screened.ts`)
   */
  clearedScreened: number;
};

/** `GET /api/admin/actors` が返す 1 件。声優起点の走行が誰を調べるかを決める材料 */
export type ActorDictionaryEntry = {
  id: string;
  slug: string;
  canonicalName: string;
  nameEn?: string;
  aliases: Array<{ name: string; verified: boolean }>;
};

/** `POST /api/admin/anilist` に送る 1 回ぶん。検証そのものはサーバー側の zod に任せる */
export type AniListIngestPayload = {
  protocolVersion: number;
  runId: string;
  startedAt: string;
  seasons: Array<{ year: number; season: AnimeSeason }>;
  actors: Array<{
    anilistStaffId: number;
    nativeName: string;
    fullName?: string;
    gender?: VoiceActorGender;
    imageUrl?: string;
    latestSeason?: { year: number; season: AnimeSeason };
  }>;
  anime: Array<{
    id: string;
    slug: string;
    titleNative?: string;
    titleRomaji: string;
    titleEnglish?: string;
    seasonYear: number;
    season: AnimeSeason;
    coverImageUrl?: string;
    coverImageColor?: string;
    format?: AnimeFormat;
    popularity?: number;
    startDate?: string;
    endDate?: string;
    synonyms?: string[];
    appearances: Array<{
      anilistStaffId: number;
      characterId: string;
      characterNameNative?: string;
      characterNameFull?: string;
      characterImageUrl?: string;
      role: AnimeRole;
    }>;
  }>;
};

/** `POST /api/admin/anilist` の応答。初めて見た声優は後続の走行が使う */
export type AniListIngestResponse = {
  runId: string;
  actors: number;
  newActors: Array<{
    id: string;
    slug: string;
    canonicalName: string;
    anilistStaffId: number;
  }>;
  skippedActors: number;
  anime: number;
  appearances: number;
  newAppearances: number;
  droppedAppearances: number;
  synonyms: number;
  clearedScreened: number;
};

/** `POST /api/admin/actor-attributes` に送る 1 件 */
export type ActorAttributeSeed = {
  voiceActorId: string;
  attribute: VoiceActorAttribute;
  source: AttributeSource;
  value: string;
};

/**
 * 走行が声優を指すのに要る最小限。誰を調べて、どの名前で検索するかだけを持つ。
 * 投入用の `ActorSeed` と分けてあるのは、走行が台帳から引くときに
 * staff id や性別を必要としないため (`GET /api/admin/actors` もそれらを返さない)
 */
export type CrawlActor = {
  id: string;
  slug: string;
  canonicalName: string;
  /** ローマ字表記。空白入りの検索候補を作るかどうかの判定に使う */
  nameEn?: string;
  aliases?: Array<{ name: string; source: string; verified: boolean }>;
};

/**
 * シード投入 (`POST /api/admin/actors`) の 1 件。検証そのものはサーバー側の zod に任せる。
 *
 * かなと表示用ローマ字は持たない。読み取り側が見るのは付加情報の表なので、
 * 入れるのは `POST /api/admin/actor-attributes`
 */
export type ActorSeed = CrawlActor & {
  /** 声優を指す鍵。サーバー側の zod も必須にしている */
  anilistStaffId: number;
  /** 省くとサーバー側の zod が "unknown" を入れる */
  gender?: VoiceActorGender;
};

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

  upsertActors(seeds: readonly ActorSeed[]): Promise<UpsertActorsResponse> {
    return this.#send<UpsertActorsResponse>("POST", "/api/admin/actors", seeds);
  }

  /**
   * 声優起点の走行が「誰を調べるか」を引く辞書。台帳は DB にしかないので、
   * リストをファイルで配らない。`neverCrawled` を立てると一度も引いていない声優だけになる
   */
  async listActors(options: { neverCrawled?: boolean } = {}): Promise<ActorDictionaryEntry[]> {
    const query = options.neverCrawled === true ? "?never-crawled=1" : "";
    const entries = await this.#send<unknown>("GET", `/api/admin/actors${query}`);
    if (!Array.isArray(entries)) throw new AdminApiError("actors が配列を返さなかった");
    return entries as ActorDictionaryEntry[];
  }

  /** AniList の取得 1 回ぶん。声優の ID と slug はサーバーが決めて応答で返す */
  ingestAniList(payload: AniListIngestPayload): Promise<AniListIngestResponse> {
    return this.#send<AniListIngestResponse>("POST", "/api/admin/anilist", payload);
  }

  /** 付加情報 (かな、表示用ローマ字) を出どころ付きで書く */
  writeActorAttributes(
    seeds: readonly ActorAttributeSeed[],
  ): Promise<{ written: number; skipped: number }> {
    return this.#send("POST", "/api/admin/actor-attributes", seeds);
  }

  ingest(payload: IngestPayload): Promise<IngestResponse> {
    return this.#send<IngestResponse>("POST", "/api/admin/ingest", payload);
  }

  /**
   * 詳細取得を省いてよい商品 ID。
   *
   * 既定は「DB にある作品」だけ。`includeScreened` を立てると「見たが対象声優が
   * 居なかった作品」も混ざる。混ぜてよいのは日次の走行だけで、声優起点は対象声優が
   * 居なくても保存するので、混ぜると一覧の情報だけで保存してしまう
   */
  async knownIds(storeSlug: StoreSlug, includeScreened = false): Promise<Set<string>> {
    const query = `store=${storeSlug}${includeScreened ? "&screened=1" : ""}`;
    const ids = await this.#send<unknown>("GET", `/api/admin/known-ids?${query}`);
    if (!Array.isArray(ids)) throw new AdminApiError("known-ids が配列を返さなかった");
    return new Set(ids.filter((id): id is string => typeof id === "string"));
  }

  async #send<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const url = `${this.#baseUrl}${path}`;
    const response = await this.#sendWithRetry(method, url, path, body);

    const text = await response.text();
    if (!response.ok) {
      const detail = `${method} ${path} が HTTP ${response.status}: ${text.slice(0, 500)}`;
      // 409 は「クローラーが古い」の合図。呼び出し側が走行ごと止められるよう型で区別する
      if (response.status === 409) throw new IngestProtocolMismatchError(detail);
      // 本文には zod の issue 一覧が入ることがあるので、切り詰めたうえでそのまま見せる
      throw new AdminApiError(detail);
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
