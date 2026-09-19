// scripts/reresolve-unmatched-credits.mjs
//
// なぜ: ingest は取り込んだ時点の名寄せ規則で判定して終わりなので、規則を変えても
// 過去の `unmatched` は解けないまま残る。`normalizeName` に異体字の畳み込みを入れた
// ぶんを既存データに反映するために、遡って解き直す。
//
// 名寄せの判定そのものは `src/domain/identity.ts` の `resolveCredit` を呼ぶ。
// サーバー側の `reresolveUnmatchedCredits` (src/server/queries/admin.ts) と同じ関数なので、
// 判定がここだけ独自になることはない。違うのは SQL の組み立て方だけ
// (このスクリプトは node:sqlite で D1 の sqlite を直接開く。drizzle は `@/` の別名解決が要り、
// 素の node からは読めないため)。
//
//   node scripts/reresolve-unmatched-credits.mjs           # 数えるだけ (既定)
//   node scripts/reresolve-unmatched-credits.mjs --apply   # 実際に書き込む
//
// `confidence = 'unmatched'` の行しか触らない。手で割り当てた行は対象外なので剥がれない。
// 解けなかった行はそのまま残るだけなので、何度実行しても結果は同じ (冪等)。

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { resolveCredit } from "../src/domain/identity.ts";

const D1_STATE_DIR = path.join(".wrangler", "state", "v3", "d1", "miniflare-D1DatabaseObject");
// 控えは miniflare の状態ディレクトリの外に置く。中に置くと miniflare の管理対象と紛れる
const BACKUP_DIR = path.join(".wrangler", "backups");
/** 報告に出す上位グループ数 */
const TOP_GROUPS = 20;

function findD1SqliteFile(d1StateDir) {
  if (!existsSync(d1StateDir)) return null;
  const candidates = readdirSync(d1StateDir)
    .filter((name) => path.extname(name) === ".sqlite" && name !== "metadata.sqlite")
    .map((name) => path.join(d1StateDir, name));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return candidates[0];
}

function countByConfidence(db) {
  const rows = db.prepare("SELECT confidence, count(*) AS n FROM audio_credits GROUP BY 1").all();
  return Object.fromEntries(rows.map((row) => [row.confidence, row.n]));
}

/** 解決できた未解決グループを返す。DB は読むだけ */
export function planReresolve(db) {
  const actors = db
    .prepare("SELECT id, slug, canonical_name, status FROM voice_actors")
    .all()
    .map((row) => ({
      id: row.id,
      slug: row.slug,
      canonicalName: row.canonical_name,
      status: row.status,
    }));
  const aliases = db
    .prepare("SELECT voice_actor_id, name, source, verified FROM voice_actor_aliases")
    .all()
    .map((row) => ({
      voiceActorId: row.voice_actor_id,
      name: row.name,
      source: row.source,
      verified: row.verified === 1,
    }));
  const byId = new Map(actors.map((actor) => [actor.id, actor]));

  const groups = db
    .prepare(
      `SELECT credited_name, source_store_slug, count(*) AS n
       FROM audio_credits WHERE confidence = 'unmatched'
       GROUP BY 1, 2`,
    )
    .all();

  const resolved = [];
  for (const group of groups) {
    const { voiceActorId } = resolveCredit(group.credited_name, actors, aliases);
    const actor = voiceActorId === undefined ? undefined : byId.get(voiceActorId);
    if (!actor) continue;
    resolved.push({
      creditedName: group.credited_name,
      sourceStoreSlug: group.source_store_slug,
      count: group.n,
      voiceActorId: actor.id,
      canonicalName: actor.canonicalName,
    });
  }
  resolved.sort((a, b) => b.count - a.count || a.creditedName.localeCompare(b.creditedName));

  return {
    scannedGroups: groups.length,
    scannedCredits: groups.reduce((sum, group) => sum + group.n, 0),
    resolved,
  };
}

function apply(db, resolved) {
  const update = db.prepare(
    `UPDATE audio_credits SET voice_actor_id = ?, confidence = 'verified'
     WHERE credited_name = ? AND source_store_slug = ? AND confidence = 'unmatched'`,
  );
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const group of resolved) {
      update.run(group.voiceActorId, group.creditedName, group.sourceStoreSlug);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function main(argv) {
  const shouldApply = argv.includes("--apply");
  const sqliteFile = findD1SqliteFile(path.join(process.cwd(), D1_STATE_DIR));
  if (!sqliteFile) {
    console.error("ローカル D1 が見つかりません");
    return 1;
  }

  const db = new DatabaseSync(sqliteFile, { readOnly: !shouldApply });
  try {
    const before = countByConfidence(db);
    console.log(`対象 DB: ${sqliteFile}`);
    console.log(`実行前: unmatched ${before.unmatched ?? 0} / verified ${before.verified ?? 0}`);

    const plan = planReresolve(db);
    console.log(`未解決グループ ${plan.scannedGroups} 組 (${plan.scannedCredits} 件) を走査`);
    console.log(
      `解決できるのは ${plan.resolved.length} 組 (${plan.resolved.reduce((s, g) => s + g.count, 0)} 件)`,
    );
    for (const group of plan.resolved.slice(0, TOP_GROUPS)) {
      console.log(
        `  ${group.count} 件  ${group.creditedName} [${group.sourceStoreSlug}] → ${group.canonicalName} (${group.voiceActorId})`,
      );
    }

    if (!shouldApply) {
      console.log("\n--apply を付けていないので書き込みませんでした");
      return 0;
    }

    // 書き込む前に sqlite ファイルを控える。他のプロセスが同じ D1 を使っているため
    const backupDir = path.join(process.cwd(), BACKUP_DIR);
    mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = path.join(backupDir, `${path.basename(sqliteFile)}.${stamp}.bak`);
    copyFileSync(sqliteFile, backup);
    console.log(`\nバックアップ: ${backup}`);

    apply(db, plan.resolved);

    const after = countByConfidence(db);
    console.log(`実行後: unmatched ${after.unmatched ?? 0} / verified ${after.verified ?? 0}`);
    console.log(
      `差分: unmatched ${(before.unmatched ?? 0) - (after.unmatched ?? 0)} 件が verified になった`,
    );
    return 0;
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
