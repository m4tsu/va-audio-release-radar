import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { normalizeName } from "@/domain/normalize";
import type { StoreSlug } from "@/domain/types";
import { chunked } from "../db/chunked";
import { audioCredits, audioWorks, crawlRuns, voiceActorAliases, voiceActors } from "../db/schema";
import type { AppDb } from "../db/types";
import { loadActorIndex } from "./actors";

/** 1 グループにつき画面に出す作品例の数。多すぎると一覧が縦に伸びるので絞る */
const SAMPLE_WORKS_PER_GROUP = 3;
/** 健全性の判定に読む run の上限。声優数 × ストア数 × 数日分を賄えれば足りる */
const HEALTH_RUN_SCAN_LIMIT = 2000;
/** 前回より件数がここまで落ちたら警告する (企画書 §21) */
const WORK_COUNT_DROP_RATIO = 0.5;

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
  /** 以後の ingest で自動一致させるため `voice_actor_aliases` にも登録する */
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
};

export type CrawlerHealthEntry = {
  storeSlug: StoreSlug;
  voiceActorId: string;
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
    .where(eq(audioCredits.confidence, "unmatched"))
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
  }

  return { updated: Number(counted?.count ?? 0), aliasAdded: input.addAlias };
}

/**
 * クローラー健全性 (企画書 §21)。声優 × ストアごとに直近の run と前回の成功 run を並べ、
 * 取得件数が急に落ちていたら警告を立てる。サイト側の HTML 変更でパーサーが壊れると
 * 「エラーにはならないが 0 件」になるため、成否だけでは気づけない
 */
export async function crawlerHealth(
  db: AppDb,
  now: string = new Date().toISOString(),
): Promise<CrawlerHealth> {
  const runs = await db
    .select()
    .from(crawlRuns)
    .orderBy(desc(crawlRuns.startedAt))
    .limit(HEALTH_RUN_SCAN_LIMIT);

  const byTarget = new Map<string, Array<(typeof runs)[number]>>();
  for (const run of runs) {
    const key = groupKey(run.storeSlug, run.voiceActorId);
    const list = byTarget.get(key);
    if (list) list.push(run);
    else byTarget.set(key, [run]);
  }

  const actorNames = await loadActorNames(db, [...new Set(runs.map((run) => run.voiceActorId))]);

  const entries: CrawlerHealthEntry[] = [];
  for (const list of byTarget.values()) {
    const [latest, ...rest] = list;
    if (!latest) continue;

    const previousOk = rest.find((run) => run.status === "ok");
    const actor = actorNames.get(latest.voiceActorId);
    const { warning, reason } = judgeWarning(latest, previousOk);

    entries.push({
      storeSlug: latest.storeSlug,
      voiceActorId: latest.voiceActorId,
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
    return a.latest.startedAt < b.latest.startedAt ? 1 : -1;
  });

  const since = new Date(Date.parse(now) - 24 * 60 * 60 * 1000).toISOString();
  const recent = runs.filter((run) => run.startedAt >= since);
  return {
    entries,
    last24h: {
      ok: recent.filter((run) => run.status === "ok").length,
      error: recent.filter((run) => run.status === "error").length,
    },
  };
}

// --- 内部 ----------------------------------------------------------------

function judgeWarning(
  latest: { status: "ok" | "error"; workCount: number },
  previousOk: { workCount: number } | undefined,
): { warning: boolean; reason?: string } {
  if (latest.status === "error") {
    return { warning: true, reason: "直近の実行が失敗している" };
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
  };
}

/** 2 つの値を 1 つの Map キーにする。名前に区切り文字が入っても衝突しない形にする */
function groupKey(a: string, b: string): string {
  return `${a.length}:${a}${b}`;
}
