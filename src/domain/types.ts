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
 * どちらでもない送信を書けなくしないために `other` を置く。
 *
 * `correction` は掲載内容の訂正の申し出。他の 3 つと違って、受け取る側が次に行うのは
 * データの書き換えで、根拠を確かめてからでないと実在の人物に誤った出演作を結び付ける
 * (docs/product.md の「別名義」)。区別できないと本文を全部読むまで選り分けられない
 */
export type InquiryKind = "request" | "bug" | "correction" | "other";

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

/**
 * 声優の付加情報の属性。供給元 (AniList) が答えない問いへの答えで、無くても声優として成立する。
 * 同じ属性に出どころが複数ありうるので、`voice_actor_attributes` に出どころごとの行で持ち、
 * 読むときに属性ごとの優先順位で 1 つ選ぶ。
 *
 * - `nameKana`: 読み。検索と一覧の並びに使う
 * - `nameEn`: 表示用のローマ字。本人・事務所の公表表記。無ければ供給元の写し (`voice_actors.name_en`) を使う
 * - `visibility`: 公開状態。取り下げの申し出があったときに書く
 */
export type VoiceActorAttribute = "nameKana" | "nameEn" | "visibility";

/**
 * 付加情報の出どころ。`editorial` は人が書いた訂正で、他は取得元のサイト。
 * どの出どころも自分の行だけを書き、他の出どころの行を消したり上書きしたりしない。
 *
 * AniList はここに並ばない。供給元が 1 つに決まる値 (表記・性別・画像) は
 * `voice_actors` の列に写すので、付加情報の行にはならない
 */
export type AttributeSource = "editorial" | "wikipedia" | "wikidata";

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

/** 並びはそのまま画面の選択肢の並びになる。よく来るものから置き、どれでもない `other` を最後にする */
export const INQUIRY_KINDS = [
  "request",
  "bug",
  "correction",
  "other",
] as const satisfies readonly InquiryKind[];

export const LOCALES = ["ja", "en"] as const satisfies readonly Locale[];

export const VOICE_ACTOR_ATTRIBUTES = [
  "nameKana",
  "nameEn",
  "visibility",
] as const satisfies readonly VoiceActorAttribute[];

export const ATTRIBUTE_SOURCES = [
  "editorial",
  "wikipedia",
  "wikidata",
] as const satisfies readonly AttributeSource[];

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
const _voiceActorAttributesCoverAllTypes: AssertSameLiteralSet<
  VoiceActorAttribute,
  (typeof VOICE_ACTOR_ATTRIBUTES)[number]
> = true;
const _attributeSourcesCoverAllTypes: AssertSameLiteralSet<
  AttributeSource,
  (typeof ATTRIBUTE_SOURCES)[number]
> = true;
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
  _voiceActorAttributesCoverAllTypes,
  _attributeSourcesCoverAllTypes,
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
