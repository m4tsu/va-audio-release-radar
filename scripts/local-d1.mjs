// scripts/local-d1.mjs
//
// 手元の D1 (miniflare が書き出す sqlite) の場所と、直近のクロールの判定。
// 検査・書き出し・復元のスクリプトと issue-task のシェルが同じ判定を使うよう 1 か所に置く。
// 手元の D1 は同じマシンの全セッションが共有しているので (CLAUDE.md の「ローカルの共有資源」)、
// 作り直す前に別プロセスが書き込んでいないかを確かめる必要がある。
//
//   node scripts/local-d1.mjs last-crawl [<リポジトリのルート>]   # crawl_runs.started_at の最大値。無ければ何も出さない

import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

/** miniflare (wrangler --local) が D1 の sqlite を書き出す場所 (リポジトリのルートからの相対) */
export const D1_STATE_DIR = path.join(".wrangler", "state", "v3", "d1", "miniflare-D1DatabaseObject");

/** これより新しい取り込みの記録があれば、別のプロセスがクロール中とみなす */
export const RECENT_RUN_MS = 10 * 60 * 1000;

/**
 * ローカル D1 の sqlite ファイルを探す。miniflare は D1 バインディングごとに
 * ハッシュ化したファイル名の sqlite を state ディレクトリ以下に作るため、
 * ファイル名では特定できない。miniflare 自身の管理用ファイル (metadata.sqlite)
 * を除いた .sqlite の中から最終更新が一番新しいものを対象 DB とみなす。
 * 候補が無ければ「ローカル D1 がまだ存在しない」として null を返す。
 */
export function findD1SqliteFile(d1StateDir) {
  if (!existsSync(d1StateDir)) return null;
  const candidates = readdirSync(d1StateDir)
    .filter((name) => path.extname(name) === ".sqlite" && name !== "metadata.sqlite")
    .map((name) => path.join(d1StateDir, name));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return candidates[0];
}

/** 直近の取り込みの記録。表が無い (作り立て) なら null */
export function latestRunStartedAt(db) {
  const exists = db
    .prepare("select 1 from sqlite_master where type = 'table' and name = 'crawl_runs'")
    .get();
  if (!exists) return null;
  const row = db.prepare("select max(started_at) as at from crawl_runs").get();
  return row?.at ?? null;
}

/**
 * sqlite を読み取り専用で開いて関数を適用する。無ければ undefined。
 * 読み取り専用なので、クロールが書き込み中でも安全に開ける
 */
export function readLocalD1(d1StateDir, fn) {
  const sqliteFile = findD1SqliteFile(d1StateDir);
  if (!sqliteFile) return undefined;
  const db = new DatabaseSync(sqliteFile, { readOnly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  const [command, root = process.cwd()] = process.argv.slice(2);
  if (command !== "last-crawl") {
    console.error("使い方: node scripts/local-d1.mjs last-crawl [<リポジトリのルート>]");
    process.exit(1);
  }
  const latest = readLocalD1(path.join(root, D1_STATE_DIR), latestRunStartedAt);
  if (latest) process.stdout.write(String(latest));
}
