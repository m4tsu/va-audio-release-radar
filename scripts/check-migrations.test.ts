// scripts/check-migrations.test.ts
//
// 実際のローカル D1 (.wrangler/state/...) や migrations/ には一切触れない。
// すべて一時ディレクトリに作ったダミーの sqlite / .sql ファイルに対してテストする。
// (T16 がクロール中にローカル D1 へ書き込んでいる環境と並行して実行しても安全にするため)

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { run } from "./check-migrations.mjs";

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

function makeTempDir() {
  tempDir = mkdtempSync(path.join(tmpdir(), "check-migrations-test-"));
  return tempDir;
}

function writeMigrationFiles(migrationsDir: string, names: string[]) {
  for (const name of names) {
    writeFileSync(path.join(migrationsDir, name), "-- dummy\n");
  }
}

function createD1Sqlite(d1StateDir: string, appliedNames: string[]) {
  const sqliteFilePath = path.join(d1StateDir, "fake-d1.sqlite");
  const db = new DatabaseSync(sqliteFilePath);
  db.exec("CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT)");
  const insert = db.prepare("INSERT INTO d1_migrations (name, applied_at) VALUES (?, ?)");
  for (const name of appliedNames) {
    insert.run(name, "2026-09-18 00:00:00");
  }
  db.close();
  return sqliteFilePath;
}

describe("check-migrations", () => {
  it("未適用のマイグレーションがある場合は終了コード 1 とメッセージを返す", () => {
    const dir = makeTempDir();
    const migrationsDir = path.join(dir, "migrations");
    const d1StateDir = path.join(dir, "d1state");
    mkdirSync(migrationsDir, { recursive: true });
    mkdirSync(d1StateDir, { recursive: true });

    writeMigrationFiles(migrationsDir, ["0000_a.sql", "0001_b.sql", "0002_c.sql"]);
    createD1Sqlite(d1StateDir, ["0000_a.sql"]);

    const result = run({
      cwd: dir,
      env: {
        MIGRATIONS_CHECK_DIR: migrationsDir,
        MIGRATIONS_CHECK_D1_STATE_DIR: d1StateDir,
      },
    });

    expect(result.code).toBe(1);
    expect(result.message).toContain("0001_b.sql");
    expect(result.message).toContain("0002_c.sql");
    expect(result.message).not.toContain("0000_a.sql");
    expect(result.message).toContain("npx wrangler d1 migrations apply DB --local");
  });

  it("すべて適用済みの場合は終了コード 0 を返す", () => {
    const dir = makeTempDir();
    const migrationsDir = path.join(dir, "migrations");
    const d1StateDir = path.join(dir, "d1state");
    mkdirSync(migrationsDir, { recursive: true });
    mkdirSync(d1StateDir, { recursive: true });

    writeMigrationFiles(migrationsDir, ["0000_a.sql", "0001_b.sql"]);
    createD1Sqlite(d1StateDir, ["0000_a.sql", "0001_b.sql"]);

    const result = run({
      cwd: dir,
      env: {
        MIGRATIONS_CHECK_DIR: migrationsDir,
        MIGRATIONS_CHECK_D1_STATE_DIR: d1StateDir,
      },
    });

    expect(result.code).toBe(0);
  });

  it("ローカル D1 が無い場合は終了コード 0 を返す (CI で落ちないための条件)", () => {
    const dir = makeTempDir();
    const migrationsDir = path.join(dir, "migrations");
    const d1StateDir = path.join(dir, "d1state-does-not-exist");
    mkdirSync(migrationsDir, { recursive: true });
    writeMigrationFiles(migrationsDir, ["0000_a.sql"]);
    // d1StateDir は意図的に作らない (存在しないパス)

    const result = run({
      cwd: dir,
      env: {
        MIGRATIONS_CHECK_DIR: migrationsDir,
        MIGRATIONS_CHECK_D1_STATE_DIR: d1StateDir,
      },
    });

    expect(result.code).toBe(0);
    expect(result.message).toContain("スキップ");
  });
});
