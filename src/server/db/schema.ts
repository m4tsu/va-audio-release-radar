import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { CREDIT_CONFIDENCES, STORE_SLUGS, WORK_CATEGORIES } from "@/domain/types";

/**
 * D1 (SQLite) のスキーマ。設計書 (docs/design/architecture.md) §5 に対応する。
 *
 * - 列挙は src/domain/types.ts の値配列をそのまま enum に渡す。
 *   DB 側だけ選択肢が増減してドメインとずれるのを防ぐため、ここで再定義しない
 * - 日時はすべて ISO 8601 文字列 (UTC)。SQLite の日付型は使わない (D1 に型が無く比較も文字列で足りる)
 * - 真偽値は integer の 0/1。boolean モードで TS 側だけ boolean に見せる
 * - フォロー状態はブラウザ内 (Dexie) に持つのでテーブルが無い
 */

/** 声優に紐づかない列挙。ドメイン型の union と同じ並びを手で維持する */
const VOICE_ACTOR_STATUSES = ["active", "inactive", "unknown"] as const;
const ALIAS_SOURCES = ["manual", "anilist", "store"] as const;
const CRAWL_RUN_STATUSES = ["ok", "error"] as const;

export const voiceActors = sqliteTable(
  "voice_actors",
  {
    // "va_ueda-reina" のようにシードで固定する文字列 ID。自動採番にしない
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    canonicalName: text("canonical_name").notNull(),
    nameKana: text("name_kana"),
    anilistStaffId: integer("anilist_staff_id"),
    imageUrl: text("image_url"),
    status: text("status", { enum: VOICE_ACTOR_STATUSES }).notNull().default("unknown"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("voice_actors_slug_unique").on(t.slug)],
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
    adult: integer("adult", { mode: "boolean" }).notNull().default(false),
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
    price: integer("price"),
    listPrice: integer("list_price"),
    available: integer("available", { mode: "boolean" }).notNull().default(true),
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

export const crawlRuns = sqliteTable(
  "crawl_runs",
  {
    // クローラーが払い出す runId をそのまま主キーにする
    id: text("id").primaryKey(),
    storeSlug: text("store_slug", { enum: STORE_SLUGS }).notNull(),
    voiceActorId: text("voice_actor_id").notNull(),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    workCount: integer("work_count").notNull().default(0),
    newCount: integer("new_count").notNull().default(0),
    status: text("status", { enum: CRAWL_RUN_STATUSES }).notNull(),
    error: text("error"),
    /**
     * ストアが出している検索結果の総件数 (設計書 §13)。読み取れなければ NULL。
     * `work_count` は成人向けを除いた保存件数なので、総件数と一致しないことがある。
     * 網羅できたかどうかの判定には下の `coverage_complete` を使う
     */
    totalCount: integer("total_count"),
    /** 総件数ぶんを取り切れたか。総件数が読めなければ NULL (真偽を決められない) */
    coverageComplete: integer("coverage_complete", { mode: "boolean" }),
  },
  // 「同じストア × 同じ声優の前回の結果」を引いて件数の急減を検知する (設計書 §5)
  (t) => [index("crawl_runs_store_actor_started_idx").on(t.storeSlug, t.voiceActorId, t.startedAt)],
);
