import { z } from "zod";

/**
 * ドメインの公開型。ここが型の正。
 * この層は React / DB / fetch を知らない。日時は ISO 8601 文字列 (UTC)。ID は文字列
 */

export type StoreSlug = "dlsite" | "audible" | "pokedora"; // Phase 2 で "audiobookjp"
export type WorkCategory = "asmr" | "audio_drama" | "audiobook" | "situation_voice" | "other";
export type CreditConfidence = "verified" | "probable" | "unmatched";

/**
 * 年齢区分。真偽値ではなく列挙にしてあるのは、ストアが「全年齢 / R18」の
 * 2 値で割っていないことと、年齢が分からないストア (Audible) を「全年齢」と言い切らないため。
 *
 * BL はここに入れない。BL は年齢区分ではなく内容の区分で、ポケドラがストアを 4 つに
 * 割っている (men / bl / adt / adt-bl) ために混ざって見えるだけ。ストア固有の区分は
 * `StoreListing.storeSection` にそのまま残す
 */
export type AgeRating = "general" | "r18" | "unknown";

/**
 * アニメの放送クール。AniList の `MediaSeason` の値をそのまま使う。
 * 小文字に直さないのは、AniList のクエリ変数にそのまま渡せる形を保つため
 */
export type AnimeSeason = "WINTER" | "SPRING" | "SUMMER" | "FALL";

/** アニメでの役の種別。AniList の `MAIN` / `SUPPORTING` を小文字に直したもの */
export type AnimeRole = "main" | "supporting";

/**
 * アニメの形式。AniList の `MediaFormat` のうち `type: ANIME` で返りうる値をそのまま使う。
 * 一覧で TV と劇場版・OVA を見分けるために持つ
 */
export type AnimeFormat = "TV" | "TV_SHORT" | "MOVIE" | "SPECIAL" | "OVA" | "ONA" | "MUSIC";

/**
 * 問い合わせの種別。送信者が選ぶ。
 *
 * 分け方を送信者に委ねるのは、受け取る側が本文を読む前に「直せるもの (bug)」と
 * 「作るかどうかを決めるもの (request)」を見分けられるようにするため。
 * どちらでもない送信を書けなくしないために `other` を置く
 */
export type InquiryKind = "request" | "bug" | "other";

/**
 * 表示言語。i18n の辞書 (`src/app/i18n`) と、通知の本文を組む言語を持つ DB の列が同じ値を見る。
 * 辞書は src/app にあるが、DB スキーマ (src/server) は src/app を import できないので型と値はここに置く
 */
export type Locale = "ja" | "en";

/**
 * 声優の性別。真偽値ではなく列挙にしてあるのは、「女性でも男性でもないと分かっている」と
 * 「分からない」を同じ値に畳むと、絞り込みで前者が黙って消えるため。
 *
 * 出どころが利用者の編集できる外部 DB (AniList) なので、画面には文字として出さない。
 * 絞り込みの軸としてだけ使う
 */
export type VoiceActorGender = "female" | "male" | "other" | "unknown";

export type VoiceActor = {
  id: string; // 例 "va_ueda-reina" (slug 由来。シードで固定)
  slug: string; // URL 用。ローマ字小文字ハイフン ("ueda-reina")
  canonicalName: string; // "上田麗奈"
  nameKana?: string; // "うえだれいな"
  // "Reina Ueda"。slug ("ueda-reina") からは姓名の順も大文字も戻せないので別に持つ
  nameEn?: string;
  anilistStaffId?: number;
  imageUrl?: string;
  status: "active" | "inactive" | "unknown";
  gender: VoiceActorGender;
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
  ageRating: AgeRating; // 取り込み時に許可された区分だけが入る (下の DEFAULT_ALLOWED_AGE_RATINGS)
  makerName?: string; // サークル / 出版社
};

export type StoreListing = {
  audioWorkId: string;
  storeSlug: StoreSlug;
  storeProductId: string; // "RJ01698658" / ASIN
  productUrl: string; // 正規 URL。アフィリエイト URL は別項目
  affiliateUrl?: string;
  titleRaw: string;
  /**
   * ストアが自分で名乗っている区分をそのまま持つ。DLsite の `home` / `bldrama` / `girlsdrama`、
   * ポケドラの `men` / `bl` / `adt` / `adt-bl` など。解釈せずに保存するのは、
   * ストアが区分を増やしても壊れないようにするためと、BL のような年齢区分でない
   * 切り口で後から絞れるようにするため
   */
  storeSection?: string;
  /** ストアが販売終了を明示した日時。出ていない間は undefined (`decisions/0008`) */
  delistedAt?: string;
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

/**
 * アニメ 1 作品。
 * あらすじ・話数・放送局は持たない。アニメ事典にしないための歯止め (同 §5)
 */
export type AnimeTitle = {
  id: string; // "anilist:195516"
  slug: string; // titleRomaji 由来 ("sousou-no-frieren")
  titleNative: string;
  titleRomaji: string;
  // AniList で実際に null のことがある
  titleEnglish?: string;
  seasonYear: number;
  season: AnimeSeason;
  coverImageUrl?: string;
  /** 表紙から AniList が拾った代表色 ("#e4a128") */
  coverImageColor?: string;
  format?: AnimeFormat;
  /** AniList の人気度。一覧の既定の並びに使う */
  popularity?: number;
  /**
   * 放送開始日 / 終了日 ("2026-10-02")。年月日が揃っているときだけ持つ。
   * 出どころの AniList は年・月・日を個別に空で返すことがあり、
   * 欠けた値を入れると日付として比べられなくなる
   */
  startDate?: string;
  endDate?: string;
  /** AniList が持つ別名タイトル ("ロシデレ")。略称や別表記で探すために持つ */
  synonyms?: string[];
  createdAt: string;
  updatedAt: string;
};

/**
 * アニメ × キャラクター × 声優の 1 行。
 *
 * キャラクターを別テーブルに分けないのは、キャラクターが「このアニメで、この声優が」という
 * 文脈でしか使われないため。続編は mediaId が違うので別の行になり、それが正しい
 */
export type AnimeAppearance = {
  animeTitleId: string;
  voiceActorId: string;
  characterId: string; // "anilist:12345"
  characterNameNative: string; // "壬氏"
  characterNameFull?: string; // "Jinshi"
  characterImageUrl?: string;
  role: AnimeRole;
};

/**
 * 保存された問い合わせ 1 件。
 *
 * 対応状況・既読・返信は持たない。届いた事実だけを残す入れ物にしてある
 */
export type Inquiry = {
  /** 表の自動採番。送信者は ID を知らないので、外から指定できる値にしない */
  id: number;
  kind: InquiryKind;
  body: string;
  /** 返信先として送信者が任意で書くもの。未記入なら undefined */
  contact?: string;
  /** サーバーが受け取った時刻。送信者が申告した時刻は持たない */
  receivedAt: string;
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

// --- 値配列 --------------------------------------------------------------
// enum 的な型を実行時に列挙するための配列。テスト・UI の選択肢生成に使う

export const STORE_SLUGS = [
  "dlsite",
  "audible",
  "pokedora",
] as const satisfies readonly StoreSlug[];

export const WORK_CATEGORIES = [
  "asmr",
  "audio_drama",
  "audiobook",
  "situation_voice",
  "other",
] as const satisfies readonly WorkCategory[];

export const AGE_RATINGS = ["general", "r18", "unknown"] as const satisfies readonly AgeRating[];

export const VOICE_ACTOR_GENDERS = [
  "female",
  "male",
  "other",
  "unknown",
] as const satisfies readonly VoiceActorGender[];

export const ANIME_SEASONS = [
  "WINTER",
  "SPRING",
  "SUMMER",
  "FALL",
] as const satisfies readonly AnimeSeason[];

export const ANIME_ROLES = ["main", "supporting"] as const satisfies readonly AnimeRole[];

export const ANIME_FORMATS = [
  "TV",
  "TV_SHORT",
  "MOVIE",
  "SPECIAL",
  "OVA",
  "ONA",
  "MUSIC",
] as const satisfies readonly AnimeFormat[];

/**
 * シーズンの新旧を比べるための数値。大きいほど新しい。
 *
 * 年と季節の 2 列を SQL の CASE で並べると読めなくなるので、取り出してから JS で並べる。
 * 画面 (前後のシーズンへの導線) とサーバー (一覧の並び) の両方が同じ順序を要るため、
 * どちらからも import できるここに置く
 */
export function seasonOrder(item: { seasonYear: number; season: AnimeSeason }): number {
  return item.seasonYear * 4 + ANIME_SEASONS.indexOf(item.season);
}

export const CREDIT_CONFIDENCES = [
  "verified",
  "probable",
  "unmatched",
] as const satisfies readonly CreditConfidence[];

/** 並びはそのまま画面の選択肢の並びになる。よく来るものから置く */
export const INQUIRY_KINDS = ["request", "bug", "other"] as const satisfies readonly InquiryKind[];

export const LOCALES = ["ja", "en"] as const satisfies readonly Locale[];

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
const _ageRatingsCoverAllTypes: AssertSameLiteralSet<AgeRating, (typeof AGE_RATINGS)[number]> =
  true;
const _localesCoverAllTypes: AssertSameLiteralSet<Locale, (typeof LOCALES)[number]> = true;
const _voiceActorGendersCoverAllTypes: AssertSameLiteralSet<
  VoiceActorGender,
  (typeof VOICE_ACTOR_GENDERS)[number]
> = true;
const _animeSeasonsCoverAllTypes: AssertSameLiteralSet<
  AnimeSeason,
  (typeof ANIME_SEASONS)[number]
> = true;
const _animeRolesCoverAllTypes: AssertSameLiteralSet<AnimeRole, (typeof ANIME_ROLES)[number]> =
  true;
const _animeFormatsCoverAllTypes: AssertSameLiteralSet<
  AnimeFormat,
  (typeof ANIME_FORMATS)[number]
> = true;
const _inquiryKindsCoverAllTypes: AssertSameLiteralSet<
  InquiryKind,
  (typeof INQUIRY_KINDS)[number]
> = true;
void [
  _storeSlugsCoverAllTypes,
  _localesCoverAllTypes,
  _workCategoriesCoverAllTypes,
  _creditConfidencesCoverAllTypes,
  _ageRatingsCoverAllTypes,
  _voiceActorGendersCoverAllTypes,
  _animeSeasonsCoverAllTypes,
  _animeRolesCoverAllTypes,
  _animeFormatsCoverAllTypes,
  _inquiryKindsCoverAllTypes,
];

// --- 年齢区分の方針 --------------------------------------------------------

/**
 * 保存してよい年齢区分。
 *
 * R18 を外しているのは実測の結果で、対象声優 (アニメ声優の本名義) の作品が 1 件も増えない
 * 一方で Amazon アソシエイトの審査に落ちる恐れがあるため。`unknown` を許すのは Audible が
 * 年齢区分を公開しておらず、弾くとストアごと落ちるため
 */
export const DEFAULT_ALLOWED_AGE_RATINGS = [
  "general",
  "unknown",
] as const satisfies readonly AgeRating[];

/**
 * この区分の作品を保存してよいか。許可集合を引数にしてあるのは、将来 R18 を扱う判断をしたときに
 * 呼び出し側 (ingest / クローラー) の設定だけで切り替えられるようにするため。
 * ドメイン層に「R18 は捨てる」という決め打ちを埋め込まない
 */
export function isAgeRatingAllowed(
  ageRating: AgeRating,
  allowed: readonly AgeRating[] = DEFAULT_ALLOWED_AGE_RATINGS,
): boolean {
  return allowed.includes(ageRating);
}

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

/**
 * ISO 8601 の UTC 文字列 (`toISOString()` の形)。
 * 走行の時刻は管理画面の並びと集計が文字列比較で読むので、形が揃っていないと順序が壊れる
 */
const isoDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, "ISO 8601 (UTC) で指定する")
  // 形だけでは "2026-13-45T99:99:99Z" が通る。日時として読めない値は集計で NaN になる
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: "日時として読めない" });

export const rawWorkSchema = z.object({
  storeSlug: z.enum(STORE_SLUGS),
  storeProductId: z.string(),
  titleRaw: z.string(),
  productUrl: httpsUrlSchema,
  coverImageUrl: httpsUrlSchema.optional(),
  releaseDate: releaseDateSchema.optional(),
  durationSeconds: z.number().optional(),
  makerName: z.string().optional(),
  creditedNames: z.array(z.string()),
  creditedNamesComplete: z.boolean().optional(),
  storeCategory: z.string().optional(),
  genres: z.array(z.string()).optional(),
  ageRating: z.enum(AGE_RATINGS),
  storeSection: z.string().optional(),
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

// --- 問い合わせの検証 ------------------------------------------------------
// 送信フォームから保存までの境界で検証する。上限をドメインに置くのは、入力欄の残り文字数と
// サーバーの拒否が別々の値を持つと、画面では書けるのに送れない状態になるため

/**
 * 本文の上限 (文字数)。
 * 上限を置くのは、1 行の大きさを送信側に決めさせないため。
 * 不具合の再現手順を書ききれる桁にしてある
 */
export const INQUIRY_BODY_MAX_LENGTH = 2000;

/** 連絡先の上限 (文字数)。メールアドレスか SNS のアカウント 1 つが入れば足りる */
export const INQUIRY_CONTACT_MAX_LENGTH = 200;

/**
 * 送信された問い合わせの検証。`Inquiry` から表が決める項目 (id と受け取った時刻) を除いた形を作る。
 *
 * 前後の空白を落としてから長さを見るので、空白だけの本文は空として弾く。
 * 連絡先は空文字を undefined に畳む。未記入の欄はブラウザから空文字で届き、
 * そのまま保存すると「未記入」と「空文字」の 2 通りが表に混ざるため
 */
export const inquirySubmissionSchema = z.object({
  kind: z.enum(INQUIRY_KINDS),
  body: z
    .string()
    .trim()
    .min(1, "本文を入力する")
    .max(INQUIRY_BODY_MAX_LENGTH, `本文は ${INQUIRY_BODY_MAX_LENGTH} 文字以内で入力する`),
  contact: z
    .string()
    .trim()
    .max(INQUIRY_CONTACT_MAX_LENGTH, `連絡先は ${INQUIRY_CONTACT_MAX_LENGTH} 文字以内で入力する`)
    .transform((value) => (value.length === 0 ? undefined : value))
    .optional(),
});

/** 検証を通った送信内容 */
export type InquirySubmission = z.infer<typeof inquirySubmissionSchema>;

/**
 * 1 つの購読が追える声優の上限。フォローはブラウザ内で件数を制限していないので、
 * サーバーへ送る側でだけ切る。対象声優の総数よりずっと少なく、1 人が追う数としては十分な値
 */
export const PUSH_SUBSCRIPTION_MAX_ACTORS = 500;

/**
 * ブラウザが払い出す鍵は base64url (詰め物なし)。`PushSubscription.toJSON()` の `keys` がこの形。
 * そのまま DB に入れて送信時にデコードするので、形だけをここで見る
 */
const base64UrlSchema = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[A-Za-z0-9_-]+$/, "base64url で指定する");

/**
 * ブラウザから届く Web Push の購読。`endpoint` が宛先で、`https:` 以外は受け付けない
 * (送信時にそのまま fetch するため)。`voiceActorIds` はブラウザのフォロー中の声優で、
 * 空でもよい (購読してから後でフォローすることがある)
 */
export const pushSubscriptionSchema = z.object({
  endpoint: httpsUrlSchema.pipe(z.string().max(2048)),
  p256dh: base64UrlSchema(200),
  auth: base64UrlSchema(100),
  locale: z.enum(LOCALES),
  voiceActorIds: z.array(z.string().min(1).max(200)).max(PUSH_SUBSCRIPTION_MAX_ACTORS),
});

/** 検証を通った購読 */
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

/** 購読の解除。宛先だけで足りる */
export const pushUnsubscribeSchema = z.object({
  endpoint: httpsUrlSchema.pipe(z.string().max(2048)),
});
