// scripts/check-migrations.mjs
//
// なぜ: マイグレーションを生成 (`npm run db:generate`) しただけで適用を忘れると、
// コードは新しいスキーマ前提で動くのにローカル D1 は古いままになり、画面が落ちたり
// 実行中のクロールが記録も残さず静かに壊れたりする (docs/design/decisions.md §14 の事故)。
// ルール文書に書くだけでは読まれないことがあったため、`npm run check` の先頭で
// 機械的に検出する。
//
// 依存追加はしない。Node 24 標準の node:sqlite (DatabaseSync) でローカル D1 の
// sqlite ファイルを読み取り専用で開くだけ。書き込みは一切行わない。

import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const MIGRATION_FILE_RE = /^\d{4}_.*\.sql$/;

const DEFAULT_MIGRATIONS_DIR = "migrations";
// miniflare (wrangler --local) が D1 の sqlite を書き出す場所
const DEFAULT_D1_STATE_DIR = path.join(".wrangler", "state", "v3", "d1", "miniflare-D1DatabaseObject");

/**
 * 環境変数で上書きできるパスを解決する。テストでは実際の .wrangler や
 * migrations/ に触れず、一時ディレクトリを指すのに使う。
 */
function resolveDir(overrideValue, defaultRelativePath, cwd) {
  if (overrideValue) {
    return path.isAbsolute(overrideValue) ? overrideValue : path.join(cwd, overrideValue);
  }
  return path.join(cwd, defaultRelativePath);
}

export function listMigrationFiles(migrationsDir) {
  if (!existsSync(migrationsDir)) return [];
  return readdirSync(migrationsDir)
    .filter((name) => MIGRATION_FILE_RE.test(name))
    .sort();
}

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

/**
 * 適用済みマイグレーション名の集合を読む。読み取り専用で開くため、
 * 同じ sqlite ファイルに他プロセス (クローラーなど) が書き込み中でも安全。
 */
export function readAppliedMigrationNames(sqliteFilePath) {
  const db = new DatabaseSync(sqliteFilePath, { readOnly: true });
  try {
    const rows = db.prepare("SELECT name FROM d1_migrations").all();
    return new Set(rows.map((row) => row.name));
  } catch (error) {
    // d1_migrations テーブルが無い = 一度もマイグレーションが適用されていない
    if (error instanceof Error && /no such table/i.test(error.message)) {
      return new Set();
    }
    throw error;
  } finally {
    db.close();
  }
}

export function formatMissingMessage(missingFiles) {
  const list = missingFiles.map((name) => `  - ${name}`).join("\n");
  return [
    "未適用のマイグレーションがあります:",
    list,
    "",
    "次を実行してローカル D1 に適用してください:",
    "  npx wrangler d1 migrations apply DB --local",
    "",
    "コードと D1 のスキーマが食い違うと画面が落ち、実行中のクロールが記録も残さず壊れます (docs/design/decisions.md §14)。",
  ].join("\n");
}

/**
 * 検出処理の本体。cwd / env を差し替えられるようにしてあるのは、
 * 実際の .wrangler やローカル D1 に一切触れずにテストするため。
 */
export function run({ cwd = process.cwd(), env = process.env } = {}) {
  const migrationsDir = resolveDir(env.MIGRATIONS_CHECK_DIR, DEFAULT_MIGRATIONS_DIR, cwd);
  const d1StateDir = resolveDir(env.MIGRATIONS_CHECK_D1_STATE_DIR, DEFAULT_D1_STATE_DIR, cwd);

  const sqliteFile = findD1SqliteFile(d1StateDir);
  if (!sqliteFile) {
    return { code: 0, message: "ローカル D1 が無いので確認をスキップしました" };
  }

  const migrationFiles = listMigrationFiles(migrationsDir);
  const applied = readAppliedMigrationNames(sqliteFile);
  const missing = migrationFiles.filter((name) => !applied.has(name));

  if (missing.length === 0) {
    return { code: 0, message: "ローカル D1 は全てのマイグレーションが適用済みです" };
  }
  return { code: 1, message: formatMissingMessage(missing) };
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  const result = run();
  console.log(result.message);
  process.exit(result.code);
}
