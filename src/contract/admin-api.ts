import { z } from "zod";
import {
  ANIME_FORMATS,
  ANIME_ROLES,
  ANIME_SEASONS,
  ATTRIBUTE_SOURCES,
  STORE_SLUGS,
  type StoreSlug,
  VOICE_ACTOR_ATTRIBUTES,
  VOICE_ACTOR_GENDERS,
} from "../domain/index.ts";
import type { IngestResponse, ingestPayloadSchema } from "./ingest.ts";
import { dateSchema } from "./primitives.ts";

/**
 * Worker の管理 API (`/api/admin/*`) のうち、クローラーが叩くものの入出力
 */

// --- AniList の取り込み (`POST /api/admin/anilist`) -------------------------

const seasonSchema = z.object({
  year: z.number().int(),
  season: z.enum(ANIME_SEASONS),
});

/**
 * 出演者 1 人。AniList が言っている値だけを受け取る。
 * 声優の ID と slug は受け手が決めるので、送り手は持たない
 */
const anilistActorSchema = z.object({
  anilistStaffId: z.number().int(),
  /**
   * 日本語表記。ストアとの突き合わせに使う唯一の鍵なので、
   * 空白を詰めて何も残らない名前は入口で弾く (空の名前で入るとどのストアにも当たらなくなる)
   */
  nativeName: z.string().trim().min(1),
  /** "Reina Ueda"。slug の元であり、英語表示に出す名前 */
  fullName: z.string().optional(),
  gender: z.enum(VOICE_ACTOR_GENDERS).optional(),
  imageUrl: z.string().optional(),
  /** この声優の出演を確認した、今回の取得で一番新しいシーズン */
  latestSeason: seasonSchema.optional(),
});

export type AniListActorInput = z.infer<typeof anilistActorSchema>;

/**
 * 出演 1 件。声優は ID ではなく staff id で指す。
 * ID を決めるのは受け手なので、送り手はまだ知らない
 */
const anilistAppearanceSchema = z.object({
  anilistStaffId: z.number().int(),
  characterId: z.string().min(1),
  characterNameNative: z.string().optional(),
  characterNameFull: z.string().optional(),
  characterImageUrl: z.string().optional(),
  role: z.enum(ANIME_ROLES),
});

export type AniListAppearanceInput = z.infer<typeof anilistAppearanceSchema>;

const anilistAnimeSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  titleNative: z.string().optional(),
  titleRomaji: z.string().min(1),
  titleEnglish: z.string().optional(),
  seasonYear: z.number().int(),
  season: z.enum(ANIME_SEASONS),
  coverImageUrl: z.string().optional(),
  coverImageColor: z.string().optional(),
  format: z.enum(ANIME_FORMATS).optional(),
  popularity: z.number().int().optional(),
  // 年月日が揃った日付だけを受け取る。部分的な日付 (年だけ) は生成側で落としてある
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
  synonyms: z.array(z.string().min(1)).optional(),
  appearances: z.array(anilistAppearanceSchema).min(1),
});

export type AniListAnimeInput = z.infer<typeof anilistAnimeSchema>;

export const anilistIngestPayloadSchema = z.object({
  protocolVersion: z.number().int(),
  runId: z.string().min(1),
  startedAt: z.string().min(1),
  /** 今回の取得が対象にしたシーズン。古い順。取れた作品が 0 件でも記録に残す */
  seasons: z.array(seasonSchema).min(1),
  actors: z.array(anilistActorSchema),
  anime: z.array(anilistAnimeSchema),
});

export type AniListIngestPayload = z.infer<typeof anilistIngestPayloadSchema>;

/** 今回はじめて台帳に入った声優。後続のかな取得と声優名での検索がこれを使う */
export type NewActor = {
  id: string;
  slug: string;
  canonicalName: string;
  anilistStaffId: number;
};

export type AniListIngestResponse = {
  runId: string;
  /** 送られた声優の数 */
  actors: number;
  newActors: NewActor[];
  /** ローマ字が無く slug を作れないので足さなかった声優の数 */
  skippedActors: number;
  anime: number;
  /** 保存した出演の数 (更新も含む) */
  appearances: number;
  /** そのうち今回はじめて入ったもの */
  newAppearances: number;
  /** 声優を引き当てられずに落とした出演の数 */
  droppedAppearances: number;
  /** 保存した別名タイトルの数 */
  synonyms: number;
  /** 声優が増えたので捨てた「対象声優が居ない」の判断の数 */
  clearedScreened: number;
};

// --- 声優の辞書とシード (`/api/admin/actors`) --------------------------------

/**
 * `GET /api/admin/actors` の絞り込み。`never-crawled` は一度も引いていない声優、
 * `with-works` は作品を持つ声優だけ。両方は指定できない
 */
export type ActorDictionaryQuery = { "never-crawled"?: boolean; "with-works"?: boolean };

/** クローラーへ配る辞書の 1 件 (`GET /api/admin/actors`) */
export type ActorDictionaryEntry = {
  id: string;
  slug: string;
  canonicalName: string;
  /** ローマ字表記。1 語の名義かどうかの判定に使う (空白入りの検索候補を作るかが変わる) */
  nameEn?: string;
  aliases: Array<{ name: string; verified: boolean }>;
};

const aliasSourceSchema = z.enum(["manual", "anilist", "store"]);

/**
 * `POST /api/admin/actors` が受け取るシードの 1 件。
 *
 * 知らない欄は黙って落とさずに断る (`strict`)。かなと表示用ローマ字はここでは受け取らず、
 * 付加情報の表に入れるので、落とすだけにすると「送ったのに入らない値」ができる
 */
export const actorSeedSchema = z.strictObject({
  id: z.string().min(1),
  slug: z.string().min(1),
  canonicalName: z.string().min(1),
  // 声優を一意に指す鍵 (同一性)。DB の制約と合わせて必須
  anilistStaffId: z.number().int(),
  imageUrl: z.string().optional(),
  status: z.enum(["active", "inactive", "unknown"]).default("unknown"),
  // 既定を置くのは、性別を送らない既存のシードがそのまま通るようにするため
  gender: z.enum(VOICE_ACTOR_GENDERS).default("unknown"),
  aliases: z
    .array(
      z.object({
        name: z.string().min(1),
        source: aliasSourceSchema,
        verified: z.boolean().default(false),
      }),
    )
    .optional(),
});

export type ActorSeed = z.infer<typeof actorSeedSchema>;

export const actorSeedsRequestSchema = z.array(actorSeedSchema).min(1);

export type UpsertActorsResponse = {
  actors: number;
  aliases: number;
  /**
   * 辞書が増えたので捨てた「対象外」の判断の数。
   * 次の日次は、捨てたぶんの詳細を引き直す (`src/server/queries/screened.ts`)
   */
  clearedScreened: number;
};

// --- かな (`/api/admin/actor-kana`) ---------------------------------------

/** `GET /api/admin/actor-kana` の人数。省くと受け手の既定の人数になる */
export type KanaTargetQuery = { limit?: number };

/** かなを引く相手。日本語表記で引くので、名前と ID だけあればよい */
export type KanaTarget = { id: string; canonicalName: string };

/** 1 人ぶんの取得結果。かなが取れなかった人も、引いたことを残すために送る */
export const actorKanaResultSchema = z.object({
  voiceActorId: z.string().min(1),
  kana: z.string().min(1).optional(),
  /** かなが取れたときだけ。記事なら wikipedia、Wikidata の項目なら wikidata */
  source: z.enum(["wikipedia", "wikidata"]).optional(),
});

export type ActorKanaResult = z.infer<typeof actorKanaResultSchema>;

export const actorKanaRequestSchema = z.array(actorKanaResultSchema).min(1);

export type WriteActorKanaResponse = {
  /** かなを書いた人数 */
  written: number;
  /** 引いたが取れなかった人数 */
  withoutKana: number;
  /** 台帳に居なくて何も書かなかった人数 */
  skipped: number;
};

// --- 付加情報 (`POST /api/admin/actor-attributes`) --------------------------

export const actorAttributeSeedSchema = z.object({
  voiceActorId: z.string().min(1),
  attribute: z.enum(VOICE_ACTOR_ATTRIBUTES),
  source: z.enum(ATTRIBUTE_SOURCES),
  value: z.string().min(1),
});

export type ActorAttributeSeed = z.infer<typeof actorAttributeSeedSchema>;

export const actorAttributesRequestSchema = z.array(actorAttributeSeedSchema).min(1);

export type WriteActorAttributesResponse = {
  /** 書いた行数 (新規と更新の合計) */
  written: number;
  /** 居ない声優を指していて書かなかった行数 */
  skipped: number;
};

// --- 販売終了 (`POST /api/admin/delistings`) --------------------------------

/**
 * 1 件ぶんの判定。分からなかった作品は送らない。
 * `delisted: false` は「買える」という主張で、前に付いた取り下げを取り消してしまう
 */
export const delistingSchema = z.object({
  storeSlug: z.enum(STORE_SLUGS),
  storeProductId: z.string().min(1),
  /** true なら取り下げ、false なら取り下げを取り消す (また買えるようになった) */
  delisted: z.boolean(),
});

export type Delisting = z.infer<typeof delistingSchema>;

export const delistingsRequestSchema = z.array(delistingSchema).min(1);

export type RecordDelistingsResponse = {
  /** 新しく取り下げた listing の数 */
  delisted: number;
  /** 取り下げを取り消した listing の数 */
  relisted: number;
  /** 台帳に無くて何もしなかった数 */
  unknown: number;
};

// --- 既知の商品 ID (`GET /api/admin/known-ids`) ------------------------------

/**
 * `screened` を立てると「見たが対象声優が居なかった」商品 ID も混ざる。
 * 混ぜてよいのは日次の走行だけ (声優起点は対象声優が居なくても保存するため)
 */
export type KnownIdsQuery = { store: StoreSlug; screened?: boolean };

// --- エンドポイントの一覧 -----------------------------------------------------

/**
 * クエリ文字列に載せる値。真偽は true のときだけ `=1` で載り、false と undefined は載らない。
 * 受け手は `=== "1"` で読む
 */
export type AdminQuery = Record<string, string | number | boolean | undefined>;

type Get<Query extends AdminQuery, Response> = { request: Query; response: Response };
type Post<Body, Response> = { request: Body; response: Response };

/**
 * 管理 API の一覧。キーは `メソッド パス`。
 * GET の `request` はクエリ文字列、POST の `request` は JSON 本文。
 * 本文は `z.input` で持つ。既定値のある欄を送り手が省けるようにするため
 */
export type AdminApi = {
  "POST /api/admin/ingest": Post<z.input<typeof ingestPayloadSchema>, IngestResponse>;
  "POST /api/admin/anilist": Post<
    z.input<typeof anilistIngestPayloadSchema>,
    AniListIngestResponse
  >;
  "GET /api/admin/actors": Get<ActorDictionaryQuery, ActorDictionaryEntry[]>;
  "POST /api/admin/actors": Post<z.input<typeof actorSeedsRequestSchema>, UpsertActorsResponse>;
  "GET /api/admin/actor-kana": Get<KanaTargetQuery, KanaTarget[]>;
  "POST /api/admin/actor-kana": Post<
    z.input<typeof actorKanaRequestSchema>,
    WriteActorKanaResponse
  >;
  "POST /api/admin/actor-attributes": Post<
    z.input<typeof actorAttributesRequestSchema>,
    WriteActorAttributesResponse
  >;
  "POST /api/admin/delistings": Post<
    z.input<typeof delistingsRequestSchema>,
    RecordDelistingsResponse
  >;
  "GET /api/admin/known-ids": Get<KnownIdsQuery, string[]>;
};

export type AdminEndpoint = keyof AdminApi;
export type AdminRequest<K extends AdminEndpoint> = AdminApi[K]["request"];
export type AdminResponse<K extends AdminEndpoint> = AdminApi[K]["response"];
