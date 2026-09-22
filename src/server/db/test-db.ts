import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";
import type { AppDb } from "./types";

/**
 * 単体テスト用のインメモリ SQLite を作る。
 *
 * D1 はローカルでも workerd を起こす必要があり単体テストには重いので、同じ SQLite 方言の
 * libsql をインメモリで使う。スキーマは `migrations/*.sql` をそのまま適用する
 * (drizzle スキーマから DDL を組み直すと、本番に当たるマイグレーションとの差に気づけないため)。
 *
 * このファイルはテストからのみ import する。node の API を使うので Worker には載らない
 * (`tsconfig.app.json` の exclude で本番ビルドの型検査から外してある)
 */
export function createTestDb(): AppDb {
  const client = createClient({ url: ":memory:" });
  const db = drizzle(client, { schema });
  return db;
}

/**
 * マイグレーションを適用済みの DB を返す。テストごとに呼んで独立した DB を得る。
 *
 * `upToTag` を渡すと、そのマイグレーションまで (含む) で止める。既存の行がマイグレーションで
 * どう写されるかを見るテストが、古いスキーマに行を入れてから `applyMigrationsAfter` で続きを当てる
 */
export async function createMigratedTestDb(upToTag?: string): Promise<AppDb> {
  const db = createTestDb();
  for (const migration of readMigrations()) {
    await applyMigration(db, migration);
    if (migration.tag === upToTag) break;
  }
  return db;
}

/** `afterTag` より後のマイグレーションを順に当てる。`createMigratedTestDb(afterTag)` の続き */
export async function applyMigrationsAfter(db: AppDb, afterTag: string): Promise<void> {
  const migrations = readMigrations();
  const start = migrations.findIndex((migration) => migration.tag === afterTag);
  if (start < 0) throw new Error(`マイグレーション ${afterTag} が journal に無い`);
  for (const migration of migrations.slice(start + 1)) {
    await applyMigration(db, migration);
  }
}

type Migration = { tag: string; statements: string[] };

async function applyMigration(db: AppDb, migration: Migration): Promise<void> {
  for (const statement of migration.statements) {
    await db.run(statement);
  }
}

/**
 * `migrations/meta/_journal.json` の順にマイグレーション SQL を読み、文に分割する。
 * ファイル名の辞書順ではなく journal の順に従うのは、drizzle-kit がその順で適用するため
 */
function readMigrations(): Migration[] {
  const migrationsDir = path.resolve(import.meta.dirname, "../../../migrations");
  const journalRaw = readFileSync(path.join(migrationsDir, "meta/_journal.json"), "utf8");
  const journal = JSON.parse(journalRaw) as { entries?: Array<{ tag: string }> };
  const entries = journal.entries ?? [];

  return entries.map((entry) => {
    const sql = readFileSync(path.join(migrationsDir, `${entry.tag}.sql`), "utf8");
    const statements = sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    return { tag: entry.tag, statements };
  });
}
