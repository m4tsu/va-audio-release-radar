import { z } from "zod";

/**
 * ドメインの公開型。設計書 (docs/design/architecture.md) §4 のコードブロックをそのまま反映する。
 * この層は React / DB / fetch を知らない。日時は ISO 8601 文字列 (UTC)。ID は文字列
 */

export type StoreSlug = "dlsite" | "audible"; // Phase 2 で "pokedora" | "audiobookjp"
export type WorkCategory = "asmr" | "audio_drama" | "audiobook" | "situation_voice" | "other";
export type CreditConfidence = "verified" | "probable" | "unmatched";

export type VoiceActor = {
  id: string; // 例 "va_ueda-reina" (slug 由来。シードで固定)
  slug: string; // URL 用。ローマ字小文字ハイフン ("ueda-reina")
  canonicalName: string; // "上田麗奈"
  nameKana?: string; // "うえだれいな"
  anilistStaffId?: number;
  imageUrl?: string;
  status: "active" | "inactive" | "unknown";
};

export type VoiceActorAlias = {
  voiceActorId: string;
  name: string; // "上田 麗奈" など公開されている表記揺れのみ
  source: "manual" | "anilist" | "store";
  verified: boolean;
};

export type AudioWork = {
  id: string; // "{storeSlug}:{storeProductId}" (MVP ではストア横断マージをしない)
  title: string;
  category: WorkCategory;
  releaseDate?: string; // "YYYY-MM-DD"
  coverImageUrl?: string;
  durationSeconds?: number;
  adult: boolean; // MVP では常に false の作品だけ保存する
  makerName?: string; // サークル / 出版社
};

export type StoreListing = {
  audioWorkId: string;
  storeSlug: StoreSlug;
  storeProductId: string; // "RJ01698658" / ASIN
  productUrl: string; // 正規 URL。アフィリエイト URL は別項目
  affiliateUrl?: string;
  titleRaw: string;
  price?: number; // JPY
  listPrice?: number; // 定価 (セール時に price と異なる)
  available: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type AudioCredit = {
  audioWorkId: string;
  voiceActorId?: string; // 未解決なら undefined
  creditedName: string; // ストア上の表記そのまま
  role?: string;
  confidence: CreditConfidence;
  sourceStoreSlug: StoreSlug;
};

/** クローラーの adapter が返す正規化前の 1 作品 */
export type RawWork = {
  storeSlug: StoreSlug;
  storeProductId: string;
  titleRaw: string;
  productUrl: string;
  coverImageUrl?: string;
  releaseDate?: string; // "YYYY-MM-DD"
  durationSeconds?: number;
  price?: number;
  listPrice?: number;
  makerName?: string;
  creditedNames: string[]; // 声優 / ナレーターとして表記されている名前 (全員)
  storeCategory?: string; // "SOU" / "audiobook" などストア固有の分類
  genres?: string[];
  adult: boolean;
  fetchedAt: string;
};

/** ingest エンドポイントの入力 */
export type IngestPayload = {
  runId: string;
  storeSlug: StoreSlug;
  voiceActorId: string; // このクロールの対象声優
  works: RawWork[];
  error?: string; // 取得失敗時 (works は空)
  /**
   * ストアが出している検索結果の総件数 (DLsite の `pager.count` / Audible の「検索結果 N のうち」)。
   * どちらのストアも 1 ページ目しか取れないため、これと取得件数を比べて網羅率を監視する (設計書 §13)
   */
  totalCount?: number;
  /**
   * 総件数ぶんを取り切れたか。`totalCount` が取れなかったときは undefined のままにする。
   * 総件数を知らないまま「全部取れた」と記録すると、取りこぼしを見逃す方向に嘘をつくため
   */
  coverageComplete?: boolean;
};

// --- 値配列 --------------------------------------------------------------
// enum 的な型を実行時に列挙するための配列。テスト・UI の選択肢生成に使う

export const STORE_SLUGS = ["dlsite", "audible"] as const satisfies readonly StoreSlug[];

export const WORK_CATEGORIES = [
  "asmr",
  "audio_drama",
  "audiobook",
  "situation_voice",
  "other",
] as const satisfies readonly WorkCategory[];

export const CREDIT_CONFIDENCES = [
  "verified",
  "probable",
  "unmatched",
] as const satisfies readonly CreditConfidence[];

/**
 * 値配列が型の全メンバーを過不足なく含むことをコンパイル時に確認する補助型。
 * 一致していれば `true` 型になり、ずれていれば決して `true` にならないタプル型になるため、
 * 下の `const _check: ... = true` がコンパイルエラーで気づかせてくれる
 */
type AssertSameLiteralSet<Type extends string, Array_ extends string> = [Type] extends [Array_]
  ? [Array_] extends [Type]
    ? true
    : ["型にしか無い値がある", Exclude<Type, Array_>]
  : ["配列にしか無い値がある", Exclude<Array_, Type>];

const _storeSlugsCoverAllTypes: AssertSameLiteralSet<StoreSlug, (typeof STORE_SLUGS)[number]> =
  true;
const _workCategoriesCoverAllTypes: AssertSameLiteralSet<
  WorkCategory,
  (typeof WORK_CATEGORIES)[number]
> = true;
const _creditConfidencesCoverAllTypes: AssertSameLiteralSet<
  CreditConfidence,
  (typeof CREDIT_CONFIDENCES)[number]
> = true;
void [_storeSlugsCoverAllTypes, _workCategoriesCoverAllTypes, _creditConfidencesCoverAllTypes];

// --- Zod スキーマ ----------------------------------------------------------
// crawler → ingest エンドポイントの境界で検証する。推論型が上の手書き型と一致することを
// `satisfies z.ZodType<...>` で保証する (ずれていればここでコンパイルエラーになる)

/**
 * ストアから取った URL の検証。`https:` 以外は受け付けない。
 *
 * この値は `<a href>` と `<img src>` にそのまま出るので、`javascript:` や `data:` を
 * 通すとスクリプト実行の入口になる。平文の `http:` も混在コンテンツになるので弾く。
 * DLsite / Audible はどちらも https なので、これで実データを取りこぼすことはない
 */
const httpsUrlSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith("https:"), { message: "https:// の URL のみ許可する" });

/** `YYYY-MM-DD` 固定。ストア側の表記ゆれをここで弾き、DB の並べ替えを文字列比較で成立させる */
const releaseDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 形式で指定する");

export const rawWorkSchema = z.object({
  storeSlug: z.enum(STORE_SLUGS),
  storeProductId: z.string(),
  titleRaw: z.string(),
  productUrl: httpsUrlSchema,
  coverImageUrl: httpsUrlSchema.optional(),
  releaseDate: releaseDateSchema.optional(),
  durationSeconds: z.number().optional(),
  price: z.number().optional(),
  listPrice: z.number().optional(),
  makerName: z.string().optional(),
  creditedNames: z.array(z.string()),
  storeCategory: z.string().optional(),
  genres: z.array(z.string()).optional(),
  adult: z.boolean(),
  fetchedAt: z.string(),
}) satisfies z.ZodType<RawWork>;

export const ingestPayloadSchema = z.object({
  runId: z.string(),
  storeSlug: z.enum(STORE_SLUGS),
  voiceActorId: z.string(),
  works: z.array(rawWorkSchema),
  error: z.string().optional(),
  totalCount: z.number().int().nonnegative().optional(),
  coverageComplete: z.boolean().optional(),
}) satisfies z.ZodType<IngestPayload>;
