import { and, desc, eq, inArray, notExists, sql } from "drizzle-orm";
import { normalizeName } from "@/domain/normalize";
import type { StoreSlug } from "@/domain/types";
import { chunked } from "../db/chunked";
import {
  audioCredits,
  audioWorks,
  crawlRuns,
  excludedCreditNames,
  voiceActorAliases,
  voiceActors,
} from "../db/schema";
import type { AppDb } from "../db/types";
import { loadActorIndex } from "./actors";
import { STALE_AFTER_HOURS } from "./freshness";
import { clearScreened } from "./screened";

/** 1 グループにつき画面に出す作品例の数。多すぎると一覧が縦に伸びるので絞る */
const SAMPLE_WORKS_PER_GROUP = 3;
/** 健全性の判定に読む run の上限。声優数 × ストア数 × 数日分を賄えれば足りる */
const HEALTH_RUN_SCAN_LIMIT = 2000;
/** 前回より件数がここまで落ちたら警告する */
const WORK_COUNT_DROP_RATIO = 0.5;

/**
 * 2 つの時刻の差 (時)。読めない時刻は undefined を返す。
 * 「ずっと前」として数値にすると、警告文に意味のない桁が出る
 */
function hoursSince(from: string, to: string): number | undefined {
  const diff = Date.parse(to) - Date.parse(from);
  return Number.isFinite(diff) ? diff / (60 * 60 * 1000) : undefined;
}

export type UnmatchedCreditGroup = {
  creditedName: string;
  sourceStoreSlug: StoreSlug;
  count: number;
  sampleWorks: Array<{ id: string; title: string }>;
  /**
   * `normalizeName` が一致する声優。ingest の時点では未登録だった声優が後から入ると、
   * 既存の未解決 credit がここで拾えるようになる
   */
  candidate?: { id: string; slug: string; canonicalName: string };
};

export type AssignCreditInput = {
  creditedName: string;
  sourceStoreSlug: StoreSlug;
  voiceActorId: string;
  /**
   * 以後の ingest で自動一致させるため `voice_actor_aliases` にも登録する。
   * 足さないと、新着一覧の走行ではその表記しか持たない作品が毎回捨てられる
   * (照合は名前で行うので、手で割り当てた行があっても次の走行では当たらない)
   */
  addAlias: boolean;
};

export type CrawlRunSummary = {
  id: string;
  startedAt: string;
  finishedAt?: string;
  workCount: number;
  newCount: number;
  status: "ok" | "error";
  error?: string;
  /** ストアが出していた検索結果の総件数。読めなかった run では undefined */
  totalCount?: number;
  /**
   * 総件数ぶんを取り切れたか。undefined は「真偽を決められない」。
   * `totalCount` が undefined でも false は入りうる (検索先の一部を引けなかった run)
   */
  coverageComplete?: boolean;
};

export type CrawlerHealthEntry = {
  storeSlug: StoreSlug;
  /** 声優に紐付かない走行 (新着一覧) では入らない */
  voiceActorId?: string;
  voiceActorName?: string;
  voiceActorSlug?: string;
  latest: CrawlRunSummary;
  /** 直近より前で最後に成功した run。件数の比較対象 */
  previousOk?: CrawlRunSummary;
  warning: boolean;
  warningReason?: string;
};

export type CrawlerHealth = {
  entries: CrawlerHealthEntry[];
  last24h: { ok: number; error: number };
};

/** 未解決クレジットのキュー。同じ名前をまとめ、割り当ての単位 (名前 × ストア) で返す */
export async function listUnmatchedCredits(
  db: AppDb,
  limit = 100,
): Promise<UnmatchedCreditGroup[]> {
  const groups = await db
    .select({
      creditedName: audioCredits.creditedName,
      sourceStoreSlug: audioCredits.sourceStoreSlug,
      count: sql<number>`count(*)`,
    })
    .from(audioCredits)
    .where(and(eq(audioCredits.confidence, "unmatched"), notExcluded(db)))
    .groupBy(audioCredits.creditedName, audioCredits.sourceStoreSlug)
    .orderBy(desc(sql`count(*)`), audioCredits.creditedName)
    .limit(limit);

  if (groups.length === 0) return [];

  const names = [...new Set(groups.map((group) => group.creditedName))];
  const [samples, candidates] = await Promise.all([
    loadSampleWorks(db, names),
    findCandidates(db, names),
  ]);

  return groups.map((group) => {
    const key = groupKey(group.creditedName, group.sourceStoreSlug);
    const candidate = candidates.get(normalizeName(group.creditedName));
    return {
      creditedName: group.creditedName,
      sourceStoreSlug: group.sourceStoreSlug,
      count: Number(group.count),
      sampleWorks: samples.get(key) ?? [],
      ...(candidate ? { candidate } : {}),
    };
  });
}

/**
 * 未解決クレジットの手動割り当て。同じ名前・同じストアの未解決分をまとめて verified にする。
 * 1 件ずつ潰すのは現実的でないため (同じ声優が同じ表記で何十作品にも出る)
 */
export async function assignCredit(
  db: AppDb,
  input: AssignCreditInput,
): Promise<{ updated: number; aliasAdded: boolean }> {
  const target = and(
    eq(audioCredits.creditedName, input.creditedName),
    eq(audioCredits.sourceStoreSlug, input.sourceStoreSlug),
    eq(audioCredits.confidence, "unmatched"),
  );

  // 更新件数はドライバごとに返り方が違うので、先に数えてから更新する
  const [counted] = await db
    .select({ count: sql<number>`count(*)` })
    .from(audioCredits)
    .where(target);

  await db
    .update(audioCredits)
    .set({ voiceActorId: input.voiceActorId, confidence: "verified" })
    .where(target);

  if (input.addAlias) {
    // 増えたかどうかを入れる前に数える。同じ割り当てを二度押しただけで
    // 全ストアの判断を捨てると、翌日の日次が無駄に引き直す
    const [before] = await db.select({ count: sql<number>`count(*)` }).from(voiceActorAliases);
    await db
      .insert(voiceActorAliases)
      .values({
        voiceActorId: input.voiceActorId,
        name: input.creditedName,
        source: "manual",
        verified: true,
      })
      .onConflictDoUpdate({
        target: [voiceActorAliases.voiceActorId, voiceActorAliases.name],
        set: { source: "manual", verified: true },
      });
    const [after] = await db.select({ count: sql<number>`count(*)` }).from(voiceActorAliases);
    // 辞書に名前が増えたので、過去の「対象声優が居ない」の判断を捨てる。
    // 捨てないと、足したばかりの別名で落ちていた作品が日次で拾い直されない
    // (`src/server/queries/screened.ts`)
    if ((after?.count ?? 0) > (before?.count ?? 0)) await clearScreened(db);
  }

  return { updated: Number(counted?.count ?? 0), aliasAdded: input.addAlias };
}

/** 「対象声優ではない」と印を付けた表記 1 件 */
export type ExcludedCreditName = {
  creditedName: string;
  sourceStoreSlug: StoreSlug;
  note?: string;
  createdAt: string;
};

/**
 * 対象声優ではないと印を付ける。未解決キューから外れ、解決し直す対象からも外れる。
 *
 * 作品側の credit は触らない。取り込みが見つけた「この作品にこの表記があった」という事実は
 * 変わらないため。同じ名前に二度付けても印は 1 件のままで、初回の日時が残る
 */
export async function excludeCreditName(
  db: AppDb,
  input: { creditedName: string; sourceStoreSlug: StoreSlug; note?: string },
  now: string = new Date().toISOString(),
): Promise<void> {
  await db
    .insert(excludedCreditNames)
    .values({
      creditedName: input.creditedName,
      sourceStoreSlug: input.sourceStoreSlug,
      note: input.note ?? null,
      createdAt: now,
    })
    // 付け直しても初回の日時を残す。理由は渡したときだけ書き換え、渡さなければ前のまま残す
    // (理由なしで付け直して既に書いた理由を消さないため)
    .onConflictDoUpdate({
      target: [excludedCreditNames.creditedName, excludedCreditNames.sourceStoreSlug],
      set: input.note === undefined ? { note: keepNote() } : { note: input.note },
    });
}

/** 上書きしないことを表す。SQLite の DO UPDATE SET では修飾なしの列名が既存行の値を指す */
function keepNote() {
  return sql`${excludedCreditNames.note}`;
}

/** 印を外す。未解決キューに戻る */
export async function unexcludeCreditName(
  db: AppDb,
  input: { creditedName: string; sourceStoreSlug: StoreSlug },
): Promise<void> {
  await db
    .delete(excludedCreditNames)
    .where(
      and(
        eq(excludedCreditNames.creditedName, input.creditedName),
        eq(excludedCreditNames.sourceStoreSlug, input.sourceStoreSlug),
      ),
    );
}

/** 印を付けた表記の一覧。新しい順 */
export async function listExcludedCreditNames(
  db: AppDb,
  limit = 200,
): Promise<ExcludedCreditName[]> {
  const rows = await db
    .select()
    .from(excludedCreditNames)
    .orderBy(desc(excludedCreditNames.createdAt), excludedCreditNames.creditedName)
    .limit(limit);

  return rows.map((row) => ({
    creditedName: row.creditedName,
    sourceStoreSlug: row.sourceStoreSlug,
    ...(row.note === null ? {} : { note: row.note }),
    createdAt: row.createdAt,
  }));
}

/**
 * クローラー健全性。声優 × ストアごとに直近の run と前回の成功 run を並べ、
 * 取得件数が急に落ちていたら警告を立てる。サイト側の HTML 変更でパーサーが壊れると
 * 「エラーにはならないが 0 件」になるため、成否だけでは気づけない
 */
export async function crawlerHealth(
  db: AppDb,
  now: string = new Date().toISOString(),
): Promise<CrawlerHealth> {
  // 並べるのは取り込んだ時刻。`started_at` はクローラーが取得を始めた時刻で、
  // 数時間かかる走行では「いつ取り込まれたか」と大きくずれる
  const runs = await db
    .select()
    .from(crawlRuns)
    .orderBy(desc(crawlRuns.finishedAt), desc(crawlRuns.startedAt))
    .limit(HEALTH_RUN_SCAN_LIMIT);

  // 束ねる単位は ストア × 対象。声優に紐付かない走行 (新着一覧) はストアごとに 1 つの束になる
  const byTarget = new Map<string, Array<(typeof runs)[number]>>();
  for (const run of runs) {
    const key = groupKey(run.storeSlug, run.voiceActorId ?? "");
    const list = byTarget.get(key);
    if (list) list.push(run);
    else byTarget.set(key, [run]);
  }

  const actorIds = runs
    .map((run) => run.voiceActorId)
    .filter((id): id is string => id !== null && id !== "");
  const actorNames = await loadActorNames(db, [...new Set(actorIds)]);

  const entries: CrawlerHealthEntry[] = [];
  for (const list of byTarget.values()) {
    const [latest, ...rest] = list;
    if (!latest) continue;

    const previousOk = rest.find((run) => run.status === "ok");
    const actor = latest.voiceActorId === null ? undefined : actorNames.get(latest.voiceActorId);
    const { warning, reason } = judgeWarning(latest, previousOk, now);

    entries.push({
      storeSlug: latest.storeSlug,
      ...(latest.voiceActorId === null ? {} : { voiceActorId: latest.voiceActorId }),
      ...(actor ? { voiceActorName: actor.canonicalName, voiceActorSlug: actor.slug } : {}),
      latest: toRunSummary(latest),
      ...(previousOk ? { previousOk: toRunSummary(previousOk) } : {}),
      warning,
      ...(reason ? { warningReason: reason } : {}),
    });
  }

  // 要対応を上に出す。その中は直近の実行が新しい順
  entries.sort((a, b) => {
    if (a.warning !== b.warning) return a.warning ? -1 : 1;
    return recordedAt(a.latest) < recordedAt(b.latest) ? 1 : -1;
  });

  const since = new Date(Date.parse(now) - 24 * 60 * 60 * 1000).toISOString();
  const recent = runs.filter((run) => (run.finishedAt ?? run.startedAt) >= since);
  return {
    entries,
    last24h: {
      ok: recent.filter((run) => run.status === "ok").length,
      error: recent.filter((run) => run.status === "error").length,
    },
  };
}

// --- 内部 ----------------------------------------------------------------

/** 並べ替えと 24 時間の集計に使う時刻。取り込んだ時刻が無い古い行は開始時刻で代える */
function recordedAt(run: { startedAt: string; finishedAt?: string }): string {
  return run.finishedAt ?? run.startedAt;
}

function judgeWarning(
  latest: {
    status: "ok" | "error";
    workCount: number;
    voiceActorId: string | null;
    startedAt: string;
    finishedAt: string | null;
  },
  previousOk: { workCount: number } | undefined,
  now: string,
): { warning: boolean; reason?: string } {
  if (latest.status === "error") {
    return { warning: true, reason: "直近の実行が失敗している" };
  }
  // 声優に紐付かない走行 (新着一覧) は日ごとに件数が揺れるので前回比で判定しない。
  // この層の健全性は「直近に成功した取り込みがあるか」で見る (decisions/0007)。
  // 止まったことは件数ではなく、最後に成功してからの時間で分かる
  if (latest.voiceActorId === null) {
    const hours = hoursSince(latest.finishedAt ?? latest.startedAt, now);
    if (hours === undefined) return { warning: true, reason: "取り込みの時刻を読めない" };
    if (hours > STALE_AFTER_HOURS) {
      return { warning: true, reason: `${Math.floor(hours)} 時間 取り込みがない` };
    }
    return { warning: false };
  }
  if (!previousOk || previousOk.workCount === 0) {
    // 比較対象が無い / 前回も 0 件なら、落ちたのか元からそうなのか判断できない
    return { warning: false };
  }
  if (latest.workCount === 0) {
    return { warning: true, reason: `前回 ${previousOk.workCount} 件だったが 0 件になった` };
  }
  if (latest.workCount < previousOk.workCount * WORK_COUNT_DROP_RATIO) {
    return {
      warning: true,
      reason: `取得件数が前回の半分未満 (${previousOk.workCount} → ${latest.workCount})`,
    };
  }
  return { warning: false };
}

async function loadSampleWorks(
  db: AppDb,
  creditedNames: string[],
): Promise<Map<string, Array<{ id: string; title: string }>>> {
  const byGroup = new Map<string, Array<{ id: string; title: string }>>();

  // 未解決の表記は limit (既定 100) まで来るので、IN 句は必ず分割する
  for (const names of chunked(creditedNames)) {
    const rows = await db
      .select({
        creditedName: audioCredits.creditedName,
        sourceStoreSlug: audioCredits.sourceStoreSlug,
        id: audioWorks.id,
        title: audioWorks.title,
      })
      .from(audioCredits)
      .innerJoin(audioWorks, eq(audioWorks.id, audioCredits.audioWorkId))
      .where(
        and(eq(audioCredits.confidence, "unmatched"), inArray(audioCredits.creditedName, names)),
      )
      .orderBy(desc(audioWorks.updatedAt));

    for (const row of rows) {
      const key = groupKey(row.creditedName, row.sourceStoreSlug);
      const list = byGroup.get(key) ?? [];
      if (list.length >= SAMPLE_WORKS_PER_GROUP) continue;
      list.push({ id: row.id, title: row.title });
      byGroup.set(key, list);
    }
  }
  return byGroup;
}

/** 正規化後の名前 → 声優。SQL では正規化できないので JS で突き合わせる (件数は MVP 規模) */
async function findCandidates(
  db: AppDb,
  creditedNames: string[],
): Promise<Map<string, { id: string; slug: string; canonicalName: string }>> {
  const wanted = new Set(creditedNames.map(normalizeName));
  const { actors, aliases } = await loadActorIndex(db);
  const byId = new Map(actors.map((actor) => [actor.id, actor]));

  const result = new Map<string, { id: string; slug: string; canonicalName: string }>();
  const ambiguous = new Set<string>();

  const remember = (normalized: string, actorId: string) => {
    if (!wanted.has(normalized) || ambiguous.has(normalized)) return;
    const actor = byId.get(actorId);
    if (!actor) return;
    const existing = result.get(normalized);
    if (existing && existing.id !== actor.id) {
      // 同名の候補が複数ある場合は提示しない。誤った割り当てを誘発するため
      result.delete(normalized);
      ambiguous.add(normalized);
      return;
    }
    result.set(normalized, { id: actor.id, slug: actor.slug, canonicalName: actor.canonicalName });
  };

  for (const actor of actors) remember(normalizeName(actor.canonicalName), actor.id);
  for (const alias of aliases) remember(normalizeName(alias.name), alias.voiceActorId);

  return result;
}

async function loadActorNames(
  db: AppDb,
  ids: string[],
): Promise<Map<string, { slug: string; canonicalName: string }>> {
  const byId = new Map<string, { slug: string; canonicalName: string }>();
  // IN 句に並べる数を抑える。読み取る run の上限ぶん声優 id が散らばりうるため
  for (const chunk of chunked(ids)) {
    const rows = await db
      .select({
        id: voiceActors.id,
        slug: voiceActors.slug,
        canonicalName: voiceActors.canonicalName,
      })
      .from(voiceActors)
      .where(inArray(voiceActors.id, chunk));
    for (const row of rows) {
      byId.set(row.id, { slug: row.slug, canonicalName: row.canonicalName });
    }
  }
  return byId;
}

function toRunSummary(run: typeof crawlRuns.$inferSelect): CrawlRunSummary {
  return {
    id: run.id,
    startedAt: run.startedAt,
    ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
    workCount: run.workCount,
    newCount: run.newCount,
    status: run.status,
    ...(run.error ? { error: run.error } : {}),
    // NULL は `totalCount` では「総件数を読めなかった」、`coverage_complete` では
    // 「真偽を決められない」。どちらも false や 0 に丸めずに落とす
    ...(run.totalCount === null ? {} : { totalCount: run.totalCount }),
    ...(run.coverageComplete === null ? {} : { coverageComplete: run.coverageComplete }),
  };
}

/**
 * 対象声優でないと印を付けた表記を除く条件。
 *
 * 印は名前 × ストアで付くので、`audio_credits` の行と同じ組で突き合わせる。
 * 作品側の credit は未解決のまま残る (印は人の判断で、取り込みが見つけた事実ではない)
 */
function notExcluded(db: AppDb) {
  return notExists(
    db
      .select({ one: sql`1` })
      .from(excludedCreditNames)
      .where(
        and(
          eq(excludedCreditNames.creditedName, audioCredits.creditedName),
          eq(excludedCreditNames.sourceStoreSlug, audioCredits.sourceStoreSlug),
        ),
      ),
  );
}

/** 2 つの値を 1 つの Map キーにする。名前に区切り文字が入っても衝突しない形にする */
function groupKey(a: string, b: string): string {
  return `${a.length}:${a}${b}`;
}
