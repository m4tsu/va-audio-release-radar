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

/** マイグレーションを適用済みの DB を返す。テストごとに呼んで独立した DB を得る */
export async function createMigratedTestDb(): Promise<AppDb> {
  const db = createTestDb();
  for (const statement of readMigrationStatements()) {
    await db.run(statement);
  }
  return db;
}

/**
 * `migrations/meta/_journal.json` の順にマイグレーション SQL を読み、文に分割する。
 * ファイル名の辞書順ではなく journal の順に従うのは、drizzle-kit がその順で適用するため
 */
function readMigrationStatements(): string[] {
  const migrationsDir = path.resolve(import.meta.dirname, "../../../migrations");
  const journalRaw = readFileSync(path.join(migrationsDir, "meta/_journal.json"), "utf8");
  const journal = JSON.parse(journalRaw) as { entries?: Array<{ tag: string }> };
  const entries = journal.entries ?? [];

  const statements: string[] = [];
  for (const entry of entries) {
    const sql = readFileSync(path.join(migrationsDir, `${entry.tag}.sql`), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed.length > 0) statements.push(trimmed);
    }
  }
  return statements;
}
