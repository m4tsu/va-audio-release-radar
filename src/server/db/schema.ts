import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  AGE_RATINGS,
  ANIME_FORMATS,
  ANIME_ROLES,
  ANIME_SEASONS,
  ATTRIBUTE_SOURCES,
  CREDIT_CONFIDENCES,
  INQUIRY_KINDS,
  LOCALES,
  STORE_SLUGS,
  VOICE_ACTOR_ATTRIBUTES,
  VOICE_ACTOR_GENDERS,
  WORK_CATEGORIES,
} from "@/domain/types";

/**
 * D1 (SQLite) のスキーマ。ここがスキーマの正。
 *
 * - 列挙は src/domain/types.ts の値配列をそのまま enum に渡す。
 *   DB 側だけ選択肢が増減してドメインとずれるのを防ぐため、ここで再定義しない
 * - 日時はすべて ISO 8601 文字列 (UTC)。SQLite の日付型は使わない (D1 に型が無く比較も文字列で足りる)
 * - 真偽値は integer の 0/1。boolean モードで TS 側だけ boolean に見せる
 * - フォロー状態はブラウザ内 (Dexie) に持つのでテーブルが無い。サーバーが知るのは、通知を購読した
 *   ブラウザが追う声優 (`push_subscription_actors`) だけ
 *
 * 声優のデータは 3 種類に分けて持つ。どの表・列がどれかは各表の先頭コメントに書く。
 *
 * 1. 同一性: staff id、slug、初めて見た日時。作られた後は変えない
 * 2. 供給元の写し: AniList が言っている値。取り込みのたびに上書きする
 * 3. 付加情報: 供給元が答えない問いへの答え。出どころごとに行を持ち、読むときに属性ごとの優先順位で選ぶ
 */

/** 声優に紐づかない列挙。ドメイン型の union と同じ並びを手で維持する */
const VOICE_ACTOR_STATUSES = ["active", "inactive", "unknown"] as const;
const ALIAS_SOURCES = ["manual", "anilist", "store"] as const;
const CRAWL_RUN_STATUSES = ["ok", "error"] as const;

/**
 * 声優。同一性 (`id` / `slug` / `anilist_staff_id` / `first_seen_at`) と供給元の写し
 * (`canonical_name` / `name_en` / `gender` / `image_url` / `last_seen_season`) が同居する。
 * 同一性の列は作られた後に変えない。供給元の写しは取り込みのたびに AniList の値で上書きする。
 * `name_kana` / `status` は付加情報で、置き場は `voice_actor_attributes` に移る (旧列は読み取り側の切り替えまで残す)
 */
export const voiceActors = sqliteTable(
  "voice_actors",
  {
    // "va_ueda-reina" のようにシードで固定する文字列 ID。自動採番にしない
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    canonicalName: text("canonical_name").notNull(),
    nameKana: text("name_kana"),
    // 英語名 ("Reina Ueda")。slug ("ueda-reina") からは姓名の順も大文字も戻せないので列で持つ
    nameEn: text("name_en"),
    /**
     * 声優を一意に指す鍵 (同一性)。名前は表記が変わりうるので鍵にしない。
     * 全行が値を持ち、投入の入口 (`actorSeedSchema`) も必須にしているが、列は NOT NULL にしていない。
     * SQLite は既存の列に NOT NULL を後から付けられず、表の作り直しは 6 つの表から参照されている
     * この表では D1 で通らない (子の行が残ったまま親を消せない)
     */
    anilistStaffId: integer("anilist_staff_id"),
    imageUrl: text("image_url"),
    status: text("status", { enum: VOICE_ACTOR_STATUSES }).notNull().default("unknown"),
    /**
     * 性別。既定を "unknown" にしてあるのは、出どころ (AniList) が値を持たない声優を
     * 「その他」と言い切らないため。読み取り側は女性・男性を名指しで絞る
     */
    gender: text("gender", { enum: VOICE_ACTOR_GENDERS }).notNull().default("unknown"),
    /**
     * この声優を初めて見た日時 (同一性)。`created_at` と違い、行を作り直しても引き継ぐ。
     * 既存の行には `created_at` が写してある。NOT NULL にしていない理由は `anilist_staff_id` と同じ
     */
    firstSeenAt: text("first_seen_at"),
    // 出演を最後に確認したシーズン。窓から外れたことの記録であって、対象から外す条件ではない
    lastSeenSeason: text("last_seen_season"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("voice_actors_slug_unique").on(t.slug),
    uniqueIndex("voice_actors_anilist_staff_id_unique").on(t.anilistStaffId),
  ],
);

/**
 * 声優の付加情報。声優 × 属性 × 出どころ で 1 行。
 *
 * 同じ属性に出どころが複数あれば行が複数ある。どの出どころも自分の行だけを書くので、
 * 取り込みが訂正を消したり、訂正が取得値を消したりする経路が無い。
 * 表に出す値は読み取り側が属性ごとの優先順位で 1 つ選ぶ (優先順位は DB ではなくコードが持つ)
 */
export const voiceActorAttributes = sqliteTable(
  "voice_actor_attributes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    voiceActorId: text("voice_actor_id")
      .notNull()
      .references(() => voiceActors.id),
    attribute: text("attribute", { enum: VOICE_ACTOR_ATTRIBUTES }).notNull(),
    source: text("source", { enum: ATTRIBUTE_SOURCES }).notNull(),
    value: text("value").notNull(),
    recordedAt: text("recorded_at").notNull(),
  },
  (t) => [
    uniqueIndex("voice_actor_attributes_actor_attribute_source_unique").on(
      t.voiceActorId,
      t.attribute,
      t.source,
    ),
  ],
);

export const voiceActorAliases = sqliteTable(
  "voice_actor_aliases",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    voiceActorId: text("voice_actor_id")
      .notNull()
      .references(() => voiceActors.id),
    name: text("name").notNull(),
    source: text("source", { enum: ALIAS_SOURCES }).notNull(),
    verified: integer("verified", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [uniqueIndex("voice_actor_aliases_actor_name_unique").on(t.voiceActorId, t.name)],
);

export const audioWorks = sqliteTable(
  "audio_works",
  {
    // "{storeSlug}:{storeProductId}"。MVP ではストア横断のマージをしないので ID にストアを含める
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    category: text("category", { enum: WORK_CATEGORIES }).notNull(),
    releaseDate: text("release_date"),
    coverImageUrl: text("cover_image_url"),
    durationSeconds: integer("duration_seconds"),
    /**
     * 年齢区分。既定を "unknown" にしてあるのは、区分を読めなかった作品を
     * 「全年齢」と言い切らないため。読み取り側は R18 を除外する形で絞る
     */
    ageRating: text("age_rating", { enum: AGE_RATINGS }).notNull().default("unknown"),
    makerName: text("maker_name"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  // 新着順の一覧が主な読み取りなので発売日に索引を張る
  (t) => [index("audio_works_release_date_idx").on(t.releaseDate)],
);

export const storeListings = sqliteTable(
  "store_listings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    audioWorkId: text("audio_work_id")
      .notNull()
      .references(() => audioWorks.id),
    storeSlug: text("store_slug", { enum: STORE_SLUGS }).notNull(),
    storeProductId: text("store_product_id").notNull(),
    productUrl: text("product_url").notNull(),
    affiliateUrl: text("affiliate_url"),
    titleRaw: text("title_raw").notNull(),
    // ストアが名乗っている区分をそのまま持つ (DLsite の home / bldrama など)。
    // 年齢区分と違って解釈しないので、ストアが区分を増やしても移行が要らない
    storeSection: text("store_section"),
    /**
     * ストアが販売終了を明示した日時。出ていない間は NULL。
     * 価格と「買えるかどうかの推定」は持たない (decisions/0008)。一覧に出ないことを理由に
     * 入れず、ストアがそう示したときだけ入れる。行は消さないので、入った後も履歴は残る
     */
    delistedAt: text("delisted_at"),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    // 取得はしたが一覧に出なかった場合も更新する。lastSeenAt との差でクロール漏れを見分ける
    lastCheckedAt: text("last_checked_at").notNull(),
  },
  (t) => [
    // ingest の upsert キー。ストア内で商品 ID は一意
    uniqueIndex("store_listings_store_product_unique").on(t.storeSlug, t.storeProductId),
    index("store_listings_audio_work_id_idx").on(t.audioWorkId),
  ],
);

export const audioCredits = sqliteTable(
  "audio_credits",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    audioWorkId: text("audio_work_id")
      .notNull()
      .references(() => audioWorks.id),
    // 名寄せできなかったクレジットは null のまま残し、管理画面の未解決キューに出す
    voiceActorId: text("voice_actor_id").references(() => voiceActors.id),
    creditedName: text("credited_name").notNull(),
    role: text("role"),
    confidence: text("confidence", { enum: CREDIT_CONFIDENCES }).notNull(),
    sourceStoreSlug: text("source_store_slug", { enum: STORE_SLUGS }).notNull(),
  },
  (t) => [
    uniqueIndex("audio_credits_work_name_store_unique").on(
      t.audioWorkId,
      t.creditedName,
      t.sourceStoreSlug,
    ),
    // 声優ページの「この声優の作品一覧」がこの索引だけで引ける
    index("audio_credits_voice_actor_id_idx").on(t.voiceActorId),
  ],
);

/**
 * 対象声優ではないと人が判断したクレジット表記。
 *
 * 未解決のクレジットの大半は、対象にしていない同人の声優やナレーターの名義で、どの声優にも
 * 割り当てられない。印を付けて管理画面のキューから外し、見るべき名前 (対象声優の別名義かも
 * しれないもの) が埋もれないようにする。
 *
 * 作品側 (`audio_credits`) は触らない。印は「この表記は誰にも割り当てない」という人の判断で、
 * 取り込みが見つけた事実ではないため。再取り込みでこの表は書き換わらない
 */
export const excludedCreditNames = sqliteTable(
  "excluded_credit_names",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // 表記はストアごとに意味が違うので、名前だけでなくストアまで含めて 1 件とする
    creditedName: text("credited_name").notNull(),
    sourceStoreSlug: text("source_store_slug", { enum: STORE_SLUGS }).notNull(),
    /** 人が書く 1 行。後から見て判断の理由が分かるようにする */
    note: text("note"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    // 未解決キューの単位 (名前 × ストア) と同じ組で一意にする
    uniqueIndex("excluded_credit_names_name_store_unique").on(t.creditedName, t.sourceStoreSlug),
  ],
);

/**
 * お問い合わせ画面から届いた 1 件。
 *
 * 対応状況・既読・返信・削除の列を持たないのは、届いた事実と、それを受けて人がした対応とが
 * 別の性質の記録だから。前者は送信者が決めて二度と変わらず、後者は運用が決まってから形が付く。
 * 読み取りは新しい順の一覧だけなので、それ以外の索引も持たない
 */
export const inquiries = sqliteTable(
  "inquiries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind", { enum: INQUIRY_KINDS }).notNull(),
    body: text("body").notNull(),
    /** 返信先として送信者が任意で書くもの。未記入なら NULL */
    contact: text("contact"),
    /** サーバーが受け取った時刻。送信者が申告した時刻は持たない */
    receivedAt: text("received_at").notNull(),
  },
  // 新しい順の一覧が唯一の読み取りなので、受け取った時刻に索引を張る
  (t) => [index("inquiries_received_at_idx").on(t.receivedAt)],
);

/**
 * ホストごとの実行権。同じストアを 2 つのプロセスから同時に叩かないための札。
 *
 * レートリミッタはクローラーのプロセス内にあるので、走行が 2 つ動けば実効間隔は半分になる。
 * 走行主体が GitHub Actions と手元の 2 つになるため、プロセスの外に 1 つだけの札を置く
 * (`docs/architecture.md` の「取得の周期」)。
 *
 * 鍵は `crawler/lib/fetch.ts` の `rateLimitFor()` が返すキー。ストアの slug とは別で、
 * 声優の供給元 (AniList など) も同じ仕組みで守れるように文字列のまま持つ
 */
export const crawlLeases = sqliteTable("crawl_leases", {
  key: text("key").primaryKey(),
  /** 札を持っている走行。返却と延長はこれが一致する相手にだけ許す */
  holder: text("holder").notNull(),
  acquiredAt: text("acquired_at").notNull(),
  /**
   * この時刻を過ぎたら空いているとみなす。
   * 走行が異常終了しても札が残り続けないよう、返却ではなく期限で解ける形にする
   */
  expiresAt: text("expires_at").notNull(),
});

/**
 * 新着一覧で見て「対象声優が 1 人も出ていない」と判断した商品。
 *
 * 日次の走行はストア全体の新着を引くので、追っていない声優の作品が大量に流れてくる。
 * それは保存しない (`docs/decisions/0007-daily-crawl-from-store-feeds.md`) が、保存しないと
 * `store_listings` に入らず「既知」にもならないので、一覧から消えるまで毎日詳細を引き直す。
 * ここに残して 2 度目以降の詳細取得を省く。
 *
 * **作品の情報は持たない。** 持つのは「この商品 ID は見た」という事実だけで、
 * 出演者の表記も題名も残さない (残さない判断は上の決定記録の「帰結」)。
 *
 * 判断の材料は声優の辞書なので、**辞書に名前が増えたら**この表は捨てる
 * (`src/server/queries/screened.ts`)。捨てないと、新しく追った声優の既存作品が永久に入らない。
 *
 * 増えたかどうかは行数で見るので、行数が変わらない変更 (声優の改名、別名の検証済みへの
 * 切り替え) では捨てない。どちらも名寄せの答えを変えうるが、その作品は月次の声優起点が
 * 新しい名前で引いて拾う (あちらは対象声優が居なくても保存するので、この表を見ない)
 */
export const screenedStoreProducts = sqliteTable(
  "screened_store_products",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    storeSlug: text("store_slug", { enum: STORE_SLUGS }).notNull(),
    storeProductId: text("store_product_id").notNull(),
    /** 見た日時。捨てる判断には使っていないが、溜まり方を後から見られるように持つ */
    screenedAt: text("screened_at").notNull(),
  },
  (t) => [
    // クローラーが引くのはストア単位の ID 一覧。重複も防ぐ
    uniqueIndex("screened_store_products_store_product_unique").on(t.storeSlug, t.storeProductId),
  ],
);

export const crawlRuns = sqliteTable(
  "crawl_runs",
  {
    // クローラーが払い出す runId をそのまま主キーにする
    id: text("id").primaryKey(),
    storeSlug: text("store_slug", { enum: STORE_SLUGS }).notNull(),
    /**
     * この走行が対象にした声優。ストアの新着一覧を起点にした走行 (decisions/0007) は
     * 特定の声優を対象にしないので NULL になる
     */
    voiceActorId: text("voice_actor_id"),
    /** クローラーが取得を始めた時刻。送られてこなければ取り込みを受けた時刻 */
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    workCount: integer("work_count").notNull().default(0),
    newCount: integer("new_count").notNull().default(0),
    /**
     * 対象声優が 1 人も出ていないとして捨てた作品数。
     * 声優に紐付かない走行 (ストアの新着一覧) でだけ増える。取れた件数と保存した件数の差が
     * ここに出るので、照合そのものが壊れた走行を後から見分けられる (管理画面にはまだ出ない)
     */
    skippedNoTargetActorCount: integer("skipped_no_target_actor_count").notNull().default(0),
    status: text("status", { enum: CRAWL_RUN_STATUSES }).notNull(),
    error: text("error"),
    /**
     * ストアが出している検索結果の総件数。読み取れなければ NULL。
     * `work_count` は許可した年齢区分だけの保存件数なので、総件数と一致しないことがある。
     * 網羅できたかどうかの判定には下の `coverage_complete` を使う
     */
    totalCount: integer("total_count"),
    /**
     * 総件数ぶんを取り切れたか。NULL は「真偽を決められない」。
     * `total_count` が NULL でも 0 (取り切れていない) は入りうる。
     * 検索先の一部を見に行けなかった走行がこの形になる
     */
    coverageComplete: integer("coverage_complete", { mode: "boolean" }),
  },
  // 「同じストア × 同じ声優の前回の結果」を引いて件数の急減を検知する
  (t) => [index("crawl_runs_store_actor_started_idx").on(t.storeSlug, t.voiceActorId, t.startedAt)],
);

/**
 * アニメ 1 作品。
 * あらすじ・話数・放送局は持たない。アニメ事典にしないための歯止め (同 §5)
 */
export const animeTitles = sqliteTable(
  "anime_titles",
  {
    // "anilist:195516"。AniList の mediaId を接頭辞付きで持ち、出典が変わっても衝突しないようにする
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    titleNative: text("title_native").notNull(),
    titleRomaji: text("title_romaji").notNull(),
    // AniList で実際に null のことがある
    titleEnglish: text("title_english"),
    seasonYear: integer("season_year").notNull(),
    season: text("season", { enum: ANIME_SEASONS }).notNull(),
    // AniList の CDN URL をそのまま参照する。画像を自前で再配信しない (同 §2)
    coverImageUrl: text("cover_image_url"),
    /** 表紙の代表色。AniList が表紙から拾った値をそのまま持つ */
    coverImageColor: text("cover_image_color"),
    format: text("format", { enum: ANIME_FORMATS }),
    /** AniList の人気度。返らないことがあるので NULL 可。一覧の既定の並びに使う */
    popularity: integer("popularity"),
    /** 放送開始日 / 終了日。揃っていない日付を持たない理由は `@/domain/types.ts` の `AnimeTitle` */
    startDate: text("start_date"),
    endDate: text("end_date"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("anime_titles_slug_unique").on(t.slug),
    // /anime/season/{year}-{season} がこの索引だけで引ける
    index("anime_titles_season_idx").on(t.seasonYear, t.season),
  ],
);

/**
 * AniList が持つ別名タイトル ("ロシデレ" / "Roshidere")。1 作品に 0 件から十数件ある。
 *
 * タイトル 1 行に畳まず別表で持つのは、アニメ名の検索が「いずれかの別名に一致」で引くため。
 * 日本語の略称だけでなくタイ語・ロシア語なども入るが、AniList が返すものを解釈せずに保存する
 * (ストアの区分を解釈しないのと同じ)
 */
export const animeTitleSynonyms = sqliteTable(
  "anime_title_synonyms",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    animeTitleId: text("anime_title_id")
      .notNull()
      .references(() => animeTitles.id),
    name: text("name").notNull(),
  },
  (t) => [
    uniqueIndex("anime_title_synonyms_title_name_unique").on(t.animeTitleId, t.name),
    index("anime_title_synonyms_anime_title_id_idx").on(t.animeTitleId),
  ],
);

/**
 * アニメ × キャラクター × 声優の 1 行。キャラクター情報はこの行に持つ。
 *
 * キャラクターを別テーブルに分けないのは、キャラクターが「このアニメで、この声優が」という
 * 文脈でしか使われないため
 */
export const animeAppearances = sqliteTable(
  "anime_appearances",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    animeTitleId: text("anime_title_id")
      .notNull()
      .references(() => animeTitles.id),
    voiceActorId: text("voice_actor_id")
      .notNull()
      .references(() => voiceActors.id),
    // "anilist:12345"
    characterId: text("character_id").notNull(),
    characterNameNative: text("character_name_native").notNull(),
    characterNameFull: text("character_name_full"),
    characterImageUrl: text("character_image_url"),
    role: text("role", { enum: ANIME_ROLES }).notNull(),
  },
  (t) => [
    // 1 人が 1 作品で複数キャラを演じることがあるので、(作品, 声優) では一意にならない。
    // キャラクターまで含めて初めて 1 行が定まる
    uniqueIndex("anime_appearances_title_character_actor_unique").on(
      t.animeTitleId,
      t.characterId,
      t.voiceActorId,
    ),
    // アニメ → 出演者、声優 → 出演アニメ の両方向を引くので索引も両方張る
    index("anime_appearances_anime_title_id_idx").on(t.animeTitleId),
    index("anime_appearances_voice_actor_id_idx").on(t.voiceActorId),
  ],
);

/**
 * Web Push の購読 1 件。ブラウザの通知許可だけで作られ、アカウントは無い。
 *
 * **endpoint は宛先であって利用者の識別子ではない。** push service がブラウザごとに払い出す
 * URL で、同じ人が別のブラウザで購読すれば別の行になり、ブラウザが購読を作り直せば別の値になる。
 * これを使って利用者を追跡しない。メールアドレスや名前のような個人を特定する項目は持たない。
 *
 * 送信で失効 (push service が 404 / 410) が分かった購読はこの行ごと消す。追う声優の対は
 * 外部キーの cascade で一緒に消える
 */
export const pushSubscriptions = sqliteTable(
  "push_subscriptions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** push service の URL。購読を作り直すと変わるので、同じブラウザの再登録は別の行として入る */
    endpoint: text("endpoint").notNull(),
    /** ブラウザが払い出した鍵 (`PushSubscription.getKey()` の base64url)。本文の暗号化に使う */
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    /** 通知の本文を組む言語。購読したときの画面の表示言語をそのまま入れる */
    locale: text("locale", { enum: LOCALES }).notNull(),
    createdAt: text("created_at").notNull(),
    /** 追う声優や鍵など、購読の内容を最後に更新した日時。送信の記録はここに書かない */
    updatedAt: text("updated_at").notNull(),
    /** 最後に送信を試みた日時。成功・失敗を問わず更新する。一度も試していなければ NULL */
    lastAttemptedAt: text("last_attempted_at"),
    /**
     * 最後に送ったダイジェストの予定時刻。その週のダイジェストを送るべき時刻 (金曜 18:00 JST を
     * UTC で表した値) で、cron が実際に起動した時刻でも送った時刻でもない。
     * 送信は上限で区切って複数回の起動に持ち越すため、同じ週のどの起動も同じ値を使い、
     * この値が一致する購読には送らない。一度も送っていなければ NULL
     */
    lastDigestScheduledAt: text("last_digest_scheduled_at"),
  },
  // 同じ購読を 2 回登録しても 1 行にする (endpoint は push service が購読ごとに一意に払い出す)
  (t) => [uniqueIndex("push_subscriptions_endpoint_unique").on(t.endpoint)],
);

/**
 * 購読が追う声優。ブラウザのフォローのうち、通知を購読したブラウザの分だけがここに写る。
 * 購読していないブラウザのフォローは従来どおりブラウザにだけある
 */
export const pushSubscriptionActors = sqliteTable(
  "push_subscription_actors",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    subscriptionId: integer("subscription_id")
      .notNull()
      .references(() => pushSubscriptions.id, { onDelete: "cascade" }),
    voiceActorId: text("voice_actor_id")
      .notNull()
      .references(() => voiceActors.id),
  },
  (t) => [
    // 購読 → 追う声優 の一覧はこの索引で引ける。同じ組を 2 行入れない
    uniqueIndex("push_subscription_actors_subscription_actor_unique").on(
      t.subscriptionId,
      t.voiceActorId,
    ),
    // 送信は「新作が出た声優 → その声優を追う購読」の向きにも引く
    index("push_subscription_actors_voice_actor_id_idx").on(t.voiceActorId),
  ],
);

/**
 * ダイジェスト送信の走行 1 回分 (cron の起動 1 回)。
 *
 * 始めた時点で 1 行書き、終わりに件数と終了日時を埋める。`crawl_runs` のように終わってから書くと、
 * Worker が実行時間の上限で途中で止まった走行が記録に残らないため。`finished_at` が NULL のまま
 * 残った行は途中で止まった走行を意味する。
 *
 * 同じ予定時刻の走行が複数行になるのは、1 回の起動で送る件数を上限で区切り、残りを次の起動に
 * 持ち越すため。週ごとの合計はその列で束ねて出す
 */
export const pushDigestRuns = sqliteTable(
  "push_digest_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /**
     * この走行が処理したダイジェストの予定時刻。同じ週の走行はこの値が同じで、
     * 送った購読の `push_subscriptions.last_digest_scheduled_at` にもこの値が入る
     */
    digestScheduledAt: text("digest_scheduled_at").notNull(),
    /** cron が実際に起動した時刻 */
    startedAt: text("started_at").notNull(),
    /** 走行が終わった時刻。途中で止まった走行は NULL のまま残る */
    finishedAt: text("finished_at"),
    /** 新作があって送る対象になった購読の数。新作の無い購読は含めない */
    subscriptionCount: integer("subscription_count").notNull().default(0),
    sentCount: integer("sent_count").notNull().default(0),
    /** push service が失効を返して消した購読の数 */
    expiredCount: integer("expired_count").notNull().default(0),
    /** 失効以外の理由で送れなかった数。購読は残り、次の起動で送り直す */
    failedCount: integer("failed_count").notNull().default(0),
  },
  // 新しい順の一覧と、同じ予定時刻の走行を束ねる読み取りのための索引
  (t) => [index("push_digest_runs_scheduled_started_idx").on(t.digestScheduledAt, t.startedAt)],
);
