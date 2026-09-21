import { and, eq, inArray, type SQL, sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { categorize } from "@/domain/category";
import { resolveCredit } from "@/domain/identity";
import {
  type AgeRating,
  DEFAULT_ALLOWED_AGE_RATINGS,
  type IngestPayload,
  isAgeRatingAllowed,
  type RawWork,
  type StoreSlug,
} from "@/domain/types";
import { chunked } from "../db/chunked";
import { audioCredits, audioWorks, crawlRuns, storeListings } from "../db/schema";
import type { AppDb, BatchStatements } from "../db/types";
import { loadActorIndex } from "./actors";
import { recordScreened } from "./screened";

/**
 * 1 回の `db.batch` に入れる文の数。D1 の batch は 1 トランザクションとして送られるので
 * 大きすぎると 1 回の応答が重くなる。30 作品なら作品・listing とも 1 回で収まる
 */
const BATCH_SIZE = 50;

export type IngestResult = {
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

export type IngestOptions = {
  /**
   * 保存してよい年齢区分。既定は `DEFAULT_ALLOWED_AGE_RATINGS` (全年齢と不明)。
   * 引数にしてあるのは、将来 R18 を扱う判断をしたときにここだけで切り替えられるようにするため
   */
  allowedAgeRatings?: readonly AgeRating[];
};

/**
 * クローラーからの取り込み。
 *
 * D1 には対話的なトランザクションが無いので、途中で失敗すると部分的に書かれた状態が残る。
 * 各文が upsert で冪等なため、同じ payload を送り直せば整合するようにしてある
 * (`first_seen_at` だけは初回の値を残すので、送り直しても初出日時は動かない)。
 *
 * 書き込みは `db.batch` にまとめる。1 作品ずつ往復すると 30 作品で 150 回近い往復になり、
 * D1 では往復のたびに待ちが入るため。順序は 作品 → listing → credit に固定する
 * (listing と credit が `audio_works` を外部キーで参照しているため)。
 *
 * `now` は呼び出し側から渡す。テストで時刻を固定できるようにするためと、
 * 1 回の取り込みの中で `last_seen_at` などを揃えるため
 */
export async function ingest(
  db: AppDb,
  payload: IngestPayload,
  now: string,
  options: IngestOptions = {},
): Promise<IngestResult> {
  const { allowedAgeRatings = DEFAULT_ALLOWED_AGE_RATINGS } = options;
  const result: IngestResult = {
    upserted: 0,
    new: 0,
    unmatched: 0,
    skippedByRating: 0,
    skippedByNoTargetActor: 0,
  };

  // 許可していない年齢区分は保存しない。件数だけ返してクローラー側の取りこぼしと区別できるようにする
  const allowed: RawWork[] = [];
  for (const work of payload.works) {
    if (isAgeRatingAllowed(work.ageRating, allowedAgeRatings)) allowed.push(work);
    else result.skippedByRating += 1;
  }

  // 名寄せの材料は作品ごとに引き直さず 1 回だけ読む
  const { actors, aliases } = await loadActorIndex(db);

  // 出演者の名寄せは作品ごとに 1 回だけ行い、結果を後段でも使い回す
  const resolvedByWork = allowed.map((work) => ({
    work,
    credits: resolveCredits(work, actors, aliases),
  }));

  /**
   * 声優に紐付かない走行 (ストアの新着一覧) では、対象声優が 1 人も解決できない作品を捨てる。
   * 新着一覧にはこのサービスが追っていない声優の作品が大量に流れてくるので、
   * 保存すると毎日それが積み上がる (`docs/decisions/0007-daily-crawl-from-store-feeds.md`)。
   *
   * 声優起点の走行では捨てない。検索した声優の名前が credit に無くても、その作品を
   * 保存すること自体は「データの不変条件」のとおり
   */
  const isFeedRun = payload.voiceActorId === undefined;
  const kept = isFeedRun
    ? resolvedByWork.filter((item) =>
        item.credits.some((credit) => credit.resolved.voiceActorId !== undefined),
      )
    : resolvedByWork;
  result.skippedByNoTargetActor = resolvedByWork.length - kept.length;

  // 捨てた商品 ID を覚えて、翌日以降に詳細を引き直さないようにする。
  // 保存しない作品は `store_listings` に入らないので、これが無いと一覧から消えるまで
  // 毎日引き直すことになる (`src/server/queries/screened.ts`)。
  //
  // **出演者が 1 人も付いていない作品は覚えない。** クローラーは詳細の取得に失敗しても
  // 一覧の情報だけで送ってくる (`crawler/adapters/dlsite.ts` の `applyDetails`) ので、
  // 1 回の取得失敗と「見たが対象声優が居ない」が同じ形になる。覚えると、取り直せば
  // 分かったはずの作品を辞書が増えるまで二度と引かなくなる
  if (isFeedRun && result.skippedByNoTargetActor > 0) {
    const keptIds = new Set(kept.map((item) => item.work.storeProductId));
    await recordScreened(
      db,
      payload.storeSlug,
      resolvedByWork
        .filter((item) => !keptIds.has(item.work.storeProductId) && item.credits.length > 0)
        .map((item) => item.work.storeProductId),
      now,
    );
  }

  const works = kept.map((item) => item.work);
  result.upserted = works.length;

  // 「今回はじめて見た listing か」は書き込む前に 1 回だけ読んで判定する。
  // 作品ごとに SELECT すると往復が作品数ぶん増えるため
  const knownProductIds = await loadKnownProductIds(
    db,
    payload.storeSlug,
    works.map((work) => work.storeProductId),
  );
  for (const work of works) {
    if (!knownProductIds.has(work.storeProductId)) result.new += 1;
  }

  const workStatements: BatchItemList = [];
  const listingStatements: BatchItemList = [];
  const creditStatements: BatchItemList = [];

  for (const { work, credits } of kept) {
    const workId = buildWorkId(work.storeSlug, work.storeProductId);
    workStatements.push(workUpsert(db, workId, work, now));
    listingStatements.push(listingUpsert(db, workId, work, now));

    for (const { name, resolved } of credits) {
      if (resolved.confidence === "unmatched") result.unmatched += 1;
      creditStatements.push(creditUpsert(db, workId, work.storeSlug, name, resolved));
    }
  }

  // 外部キーの順に流す。同じフェーズの中は互いに独立なので分割してよい
  await runBatches(db, workStatements);
  await runBatches(db, listingStatements);
  await runBatches(db, creditStatements);

  await recordRun(db, payload, result, now);
  return result;
}

/** 作品 ID は "{storeSlug}:{storeProductId}"。MVP ではストア横断のマージをしない */
export function buildWorkId(storeSlug: StoreSlug, storeProductId: string): string {
  return `${storeSlug}:${storeProductId}`;
}

// --- 内部 ----------------------------------------------------------------

/** `db.batch` に渡す前の入れ物。空のこともあるので `BatchStatements` とは別に持つ */
type BatchItemList = Array<BatchStatements[number]>;

/** 文を分割して `db.batch` に流す。0 件なら何もしない (batch は 1 件以上を要求する) */
async function runBatches(db: AppDb, statements: BatchItemList): Promise<void> {
  for (const chunk of chunked(statements, BATCH_SIZE)) {
    const [first, ...rest] = chunk;
    if (!first) continue;
    await db.batch([first, ...rest]);
  }
}

/** 既に `store_listings` にある商品 ID。新着判定に使う */
async function loadKnownProductIds(
  db: AppDb,
  storeSlug: StoreSlug,
  storeProductIds: string[],
): Promise<Set<string>> {
  const known = new Set<string>();
  for (const ids of chunked(storeProductIds)) {
    const rows = await db
      .select({ storeProductId: storeListings.storeProductId })
      .from(storeListings)
      .where(
        and(eq(storeListings.storeSlug, storeSlug), inArray(storeListings.storeProductId, ids)),
      );
    for (const row of rows) known.add(row.storeProductId);
  }
  return known;
}

function workUpsert(db: AppDb, workId: string, work: RawWork, now: string) {
  const category = categorize(work.storeSlug, work.storeCategory, work.genres, work.titleRaw);

  return db
    .insert(audioWorks)
    .values({
      id: workId,
      ageRating: work.ageRating,
      createdAt: now,
      updatedAt: now,
      title: work.titleRaw,
      category,
      releaseDate: work.releaseDate ?? null,
      coverImageUrl: work.coverImageUrl ?? null,
      durationSeconds: work.durationSeconds ?? null,
      makerName: work.makerName ?? null,
    })
    .onConflictDoUpdate({
      target: audioWorks.id,
      set: {
        title: work.titleRaw,
        category: hasCategoryEvidence(work) ? category : keep(audioWorks.category),
        // ストア側で区分が付け直されることがあるので毎回入れ直す。ここに来る作品は
        // 許可された区分だけなので、既存行が許可外のまま残ることはない
        ageRating: work.ageRating,
        // 以下は詳細を取れたときだけ埋まる。クローラーは既知の作品の詳細取得を飛ばすので
        // (`--skip-known`)、値が無いときは既存の値を残す。null で上書きすると再クロールのたびに
        // 発売日や再生時間が消える
        releaseDate: work.releaseDate ?? keep(audioWorks.releaseDate),
        coverImageUrl: work.coverImageUrl ?? keep(audioWorks.coverImageUrl),
        durationSeconds: work.durationSeconds ?? keep(audioWorks.durationSeconds),
        makerName: work.makerName ?? keep(audioWorks.makerName),
        updatedAt: now,
      },
    });
}

/**
 * upsert の DO UPDATE で「その列を更新しない」ことを表す。SQLite の DO UPDATE SET では
 * 修飾なしの列名が既存行の値を指すので、自分自身を代入すれば値が変わらない
 */
function keep<T extends AnySQLiteColumn>(column: T): SQL {
  return sql`${column}`;
}

/**
 * 分類を上書きしてよいか。DLsite はジャンルを product.json からしか取れず、詳細を飛ばすと
 * `categorize` が既定の asmr に落ちる。一度 audio_drama と判定した作品を再クロールで
 * asmr に戻さないよう、ジャンル不明の DLsite 作品では既存の分類を残す
 */
function hasCategoryEvidence(work: RawWork): boolean {
  return work.storeSlug !== "dlsite" || work.genres !== undefined;
}

function listingUpsert(db: AppDb, workId: string, work: RawWork, now: string) {
  return db
    .insert(storeListings)
    .values({
      audioWorkId: workId,
      storeSlug: work.storeSlug,
      storeProductId: work.storeProductId,
      productUrl: work.productUrl,
      titleRaw: work.titleRaw,
      storeSection: work.storeSection ?? null,
      firstSeenAt: now,
      lastSeenAt: now,
      lastCheckedAt: now,
    })
    .onConflictDoUpdate({
      target: [storeListings.storeSlug, storeListings.storeProductId],
      // first_seen_at は初回の値を残す (set に入れない)。新着判定の基準になるため
      set: {
        // 商品 URL とタイトルは毎回入れ直す。ストア側で URL 形式やタイトルが変わったときに
        // 古い値のままリンク切れを晒さないようにするため
        productUrl: work.productUrl,
        titleRaw: work.titleRaw,
        // 区分は詳細を取れたときだけ埋まる (DLsite は product.json 由来)。既知の作品では
        // 詳細取得を飛ばすので、値が無いときは null で潰さず既存の値を残す
        storeSection: work.storeSection ?? keep(storeListings.storeSection),
        // 販売終了の日時はここでは触らない。一覧に出たことは「売っている」の根拠にならず、
        // 入れるのはストアが販売終了を明示したときだけ (decisions/0008)
        delistedAt: keep(storeListings.delistedAt),
        lastSeenAt: now,
        lastCheckedAt: now,
      },
    });
}

type ResolvedCredit = ReturnType<typeof resolveCredit>;

/**
 * この作品で credit を作る名前と、その名寄せ結果。
 *
 * ここで作るのは `creditedNames` に実際に載っていた名前の credit だけ。対象声優
 * (`payload.voiceActorId`) の名前がどれにも解決されなくても、その声優への credit は作らない。
 * ストア検索は名前が一致しない作品も返すため、作ってしまうと声優ページがノイズで埋まる
 */
function resolveCredits(
  work: RawWork,
  actors: Awaited<ReturnType<typeof loadActorIndex>>["actors"],
  aliases: Awaited<ReturnType<typeof loadActorIndex>>["aliases"],
): Array<{ name: string; resolved: ResolvedCredit }> {
  const seen = new Set<string>();
  const entries: Array<{ name: string; resolved: ResolvedCredit }> = [];

  for (const creditedName of work.creditedNames) {
    const name = creditedName.trim();
    // 同じ作品に同じ名前が二度出る (本文と flyout の重複など) ことがあるので畳む
    if (name.length === 0 || seen.has(name)) continue;
    seen.add(name);
    entries.push({ name, resolved: resolveCredit(name, actors, aliases) });
  }
  return entries;
}

function creditUpsert(
  db: AppDb,
  workId: string,
  storeSlug: StoreSlug,
  name: string,
  resolved: ResolvedCredit,
) {
  return db
    .insert(audioCredits)
    .values({
      audioWorkId: workId,
      voiceActorId: resolved.voiceActorId ?? null,
      creditedName: name,
      confidence: resolved.confidence,
      sourceStoreSlug: storeSlug,
    })
    .onConflictDoUpdate({
      target: [audioCredits.audioWorkId, audioCredits.creditedName, audioCredits.sourceStoreSlug],
      set:
        resolved.confidence === "unmatched"
          ? // 自動では解決できなかった表記。管理画面で人が割り当てた行がここに当たるので、
            // 既存の `voice_actor_id` / `confidence` を消さずにそのまま残す。
            // 上書きすると、再クロールのたびに手作業の割り当てが剥がれる
            {
              voiceActorId: keep(audioCredits.voiceActorId),
              confidence: keep(audioCredits.confidence),
            }
          : // 後から声優が追加された場合に解決済みへ昇格させる
            { voiceActorId: resolved.voiceActorId ?? null, confidence: resolved.confidence },
    });
}

/**
 * クローラー健全性の記録。`payload.error` があれば取得自体が失敗しているので
 * status を error にする (このとき works は空で送られてくる)
 */
async function recordRun(
  db: AppDb,
  payload: IngestPayload,
  result: IngestResult,
  now: string,
): Promise<void> {
  const values = {
    storeSlug: payload.storeSlug,
    // 新着一覧を起点にした走行は特定の声優を対象にしない (decisions/0007)
    voiceActorId: payload.voiceActorId ?? null,
    // 取得を始めた時刻はクローラーしか知らない。送られてこなければ受け取った時刻で埋める
    startedAt: payload.startedAt ?? now,
    finishedAt: now,
    workCount: result.upserted,
    newCount: result.new,
    skippedNoTargetActorCount: result.skippedByNoTargetActor,
    status: payload.error ? ("error" as const) : ("ok" as const),
    error: payload.error ?? null,
    // 網羅率。クローラーが総件数を読めなかったときは NULL のまま残す。
    // 「分からない」と「全部取れた」を DB の段階で混ぜないため
    totalCount: payload.totalCount ?? null,
    coverageComplete: payload.coverageComplete ?? null,
  };

  await db
    .insert(crawlRuns)
    .values({ id: payload.runId, ...values })
    // 同じ runId で送り直されたら上書きする。取り込み全体を冪等に保つため
    .onConflictDoUpdate({ target: crawlRuns.id, set: values });
}
