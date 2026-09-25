import { z } from "zod";
import { AGE_RATINGS, type AgeRating, STORE_SLUGS, type StoreSlug } from "../domain/index.ts";
import { dateSchema, httpsUrlSchema, isoDateTimeSchema } from "./primitives.ts";

/**
 * `POST /api/admin/ingest` の入出力。クローラーが送り、Worker が検証する。
 * 推論型が手書き型と一致することを `satisfies z.ZodType<...>` で保証する
 * (ずれていればここでコンパイルエラーになる)
 */

/** クローラーの adapter が返す正規化前の 1 作品 */
export type RawWork = {
  storeSlug: StoreSlug;
  storeProductId: string;
  titleRaw: string;
  productUrl: string;
  coverImageUrl?: string;
  releaseDate?: string; // "YYYY-MM-DD"
  durationSeconds?: number;
  makerName?: string;
  creditedNames: string[]; // 声優 / ナレーターとして表記されている名前
  /**
   * `creditedNames` がその作品の出演者全員か。
   *
   * ストアの一覧は出演者を省くことがある (DLsite は代表 1 名、ポケドラは 2 名まで)。
   * 詳細を取れなかった作品はその省かれた名前のまま送られてくるので、
   * 「対象声優が 1 人も居ない」と見えても、全員を見ればそうではないことがある。
   * 取り込み側はこれが true の作品だけを「見た」ものとして扱う
   * (`src/server/queries/screened.ts`)。
   *
   * 省いても壊れない。付いていなければ「全員かどうか分からない」として、
   * 見たことにしない側へ倒す
   */
  creditedNamesComplete?: boolean;
  storeCategory?: string; // "SOU" / "audiobook" などストア固有の分類
  genres?: string[];
  ageRating: AgeRating;
  storeSection?: string; // ストア固有の区分 (StoreListing.storeSection と同じ値)
  /**
   * ストアが「今は買えない」と示しているか。
   *
   * 省いた作品は取り下げの判定に使わない。一覧に出ないことを理由に取り下げないのと同じで、
   * 分からないものを取り下げない (`docs/decisions/0008-no-price-no-availability.md`)。
   * false を送ると、前に付いた取り下げが取り消される (再販された作品のため)
   */
  delisted?: boolean;
  fetchedAt: string;
};

/**
 * ingest の payload 形式の版。`RawWork` / `IngestPayload` に後方互換でない変更を
 * 入れるたびに 1 つ上げる。
 *
 * これが要るのは、クローラーが数時間走る一方でサーバーはその間に差し替わりうるため。
 * 古い形のペイロードが 400 で拒否されると `crawl_runs` に行が残らず、管理画面からは
 * 「作品 0 件の声優」と見分けが付かない。
 *
 * 版が合わなければサーバーは 409 を返し、クローラーは残りを回さず即座に止まる。
 * 「静かに捨てる」より「うるさく止まる」方が被害が小さいという判断
 */
export const INGEST_PROTOCOL_VERSION = 2;

/** ingest エンドポイントの入力 */
export type IngestPayload = {
  /**
   * 送り手が期待する payload の版。`INGEST_PROTOCOL_VERSION` と一致しなければサーバーは 409。
   * 任意にせず必須にしてあるのは、省略できると古いクローラーが素通りしてしまうため
   */
  protocolVersion: number;
  runId: string;
  storeSlug: StoreSlug;
  /**
   * このクロールの対象声優。ストアの新着一覧を起点にした走行では特定の声優を対象にしないので
   * 省く (`decisions/0007`)。走行の記録 (`crawl_runs`) の声優が空になるだけで、
   * 作品の保存の仕方は変わらない
   */
  voiceActorId?: string;
  /**
   * クローラーが取得を始めた時刻。省くと取り込みを受けた時刻になる。
   * 1 回の走行は数時間に及ぶので、取得と取り込みの時刻は別の事実として扱う
   */
  startedAt?: string;
  works: RawWork[];
  error?: string; // 取得失敗時 (works は空)
  /**
   * ストアが出している検索結果の総件数 (DLsite の `pager.count` / Audible の「検索結果 N のうち」)。
   * どちらのストアも 1 ページ目しか取れないため、これと取得件数を比べて網羅率を監視する
   */
  totalCount?: number;
  /**
   * 総件数ぶんを取り切れたか。総件数を知らないまま true にはしない。
   * 取りこぼしを見逃す方向に嘘をつくため。
   * false は `totalCount` が無くても入りうる (取り切れていないことだけが分かる走行)
   */
  coverageComplete?: boolean;
};

/** `POST /api/admin/ingest` の応答 */
export type IngestResponse = {
  /** 保存した作品数。下の 2 つの理由で捨てたぶんを除いた数 */
  upserted: number;
  /** 今回はじめて見た listing の数 */
  new: number;
  /** 声優を特定できなかった credit の数。管理画面の未解決キューに積まれる */
  unmatched: number;
  /** 許可していない年齢区分として捨てた作品数 (現状は R18) */
  skippedByRating: number;
  /**
   * 対象声優が 1 人も出ていないとして捨てた作品数。
   * 声優に紐付かない走行 (ストアの新着一覧) でだけ増える
   */
  skippedByNoTargetActor: number;
};

export const rawWorkSchema = z.object({
  storeSlug: z.enum(STORE_SLUGS),
  storeProductId: z.string(),
  titleRaw: z.string(),
  productUrl: httpsUrlSchema,
  coverImageUrl: httpsUrlSchema.optional(),
  releaseDate: dateSchema.optional(),
  durationSeconds: z.number().optional(),
  makerName: z.string().optional(),
  creditedNames: z.array(z.string()),
  creditedNamesComplete: z.boolean().optional(),
  storeCategory: z.string().optional(),
  genres: z.array(z.string()).optional(),
  ageRating: z.enum(AGE_RATINGS),
  storeSection: z.string().optional(),
  delisted: z.boolean().optional(),
  fetchedAt: z.string(),
}) satisfies z.ZodType<RawWork>;

export const ingestPayloadSchema = z.object({
  protocolVersion: z.number().int(),
  runId: z.string(),
  storeSlug: z.enum(STORE_SLUGS),
  voiceActorId: z.string().optional(),
  startedAt: isoDateTimeSchema.optional(),
  works: z.array(rawWorkSchema),
  error: z.string().optional(),
  totalCount: z.number().int().nonnegative().optional(),
  coverageComplete: z.boolean().optional(),
}) satisfies z.ZodType<IngestPayload>;

/**
 * 本文から `protocolVersion` だけを取り出す。
 *
 * 全体を `ingestPayloadSchema` に通す前に呼ぶ。版が上がる変更はたいてい
 * `works` の形を変えるので、先に全体を検証すると「版がずれている」ではなく
 * 「works が不正」という的外れな 400 になり、原因が読み取れないため。
 * 数値でなければ undefined を返し、呼び出し側が不一致として扱う
 */
export function readProtocolVersion(body: unknown): number | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const value = (body as { protocolVersion?: unknown }).protocolVersion;
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}
