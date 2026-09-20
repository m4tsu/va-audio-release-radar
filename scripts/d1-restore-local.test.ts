// scripts/d1-restore-local.test.ts
//
// 実際のローカル D1 と wrangler には触れない。一時ディレクトリの sqlite と、
// 差し替えた `run` で門 (--yes、ファイル、クロール中の判定) と流し込む内容を確かめる

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { latestRunStartedAt, main } from "./d1-restore-local.mjs";

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

function setup(latestStartedAt?: string) {
  tempDir = mkdtempSync(path.join(tmpdir(), "d1-restore-test-"));
  const d1StateDir = path.join(tempDir, "d1");
  mkdirSync(d1StateDir);
  const db = new DatabaseSync(path.join(d1StateDir, "db.sqlite"));
  db.exec(`
    CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE voice_actors (id TEXT PRIMARY KEY, canonical_name TEXT NOT NULL);
    CREATE TABLE crawl_runs (id TEXT PRIMARY KEY, started_at TEXT NOT NULL);
  `);
  if (latestStartedAt) db.prepare("INSERT INTO crawl_runs VALUES ('r', ?)").run(latestStartedAt);
  db.close();
  const file = path.join(tempDir, "export.sql");
  writeFileSync(file, `INSERT INTO "voice_actors" ("id", "canonical_name") VALUES ('va', 'x');\n`);
  const calls: string[][] = [];
  const run = (args: string[]) => {
    calls.push(args);
    return JSON.stringify([{ results: [{ voice_actors: 1, crawl_runs: 0 }] }]);
  };
  const messages: string[] = [];
  const deps = {
    run,
    d1StateDir,
    stagingDir: path.join(tempDir, "staging"),
    log: (message: string) => messages.push(message),
    error: (message: string) => messages.push(message),
  };
  return { file, calls, messages, deps };
}

describe("latestRunStartedAt", () => {
  it("表が無ければ null、あれば最新の started_at", () => {
    const db = new DatabaseSync(":memory:");
    expect(latestRunStartedAt(db)).toBeNull();
    db.exec("CREATE TABLE crawl_runs (id TEXT, started_at TEXT)");
    expect(latestRunStartedAt(db)).toBeNull();
    db.exec("INSERT INTO crawl_runs VALUES ('a', '2026-09-19T00:00:00.000Z'), ('b', '2026-09-20T00:00:00.000Z')");
    expect(latestRunStartedAt(db)).toBe("2026-09-20T00:00:00.000Z");
  });
});

describe("main", () => {
  it("--yes が無ければ wrangler を呼ばずに止まる", () => {
    const { file, calls, deps } = setup();
    expect(main(["--file", file], deps)).toBe(1);
    expect(calls).toHaveLength(0);
  });

  it("ファイルが無ければ止まる", () => {
    const { calls, deps } = setup();
    expect(main(["--file", "/nonexistent.sql", "--yes"], deps)).toBe(1);
    expect(calls).toHaveLength(0);
  });

  it("直近に取り込みの記録があれば止まる", () => {
    const now = Date.parse("2026-09-20T12:00:00.000Z");
    const { file, calls, deps, messages } = setup("2026-09-20T11:55:00.000Z");
    expect(main(["--file", file, "--yes"], { ...deps, now })).toBe(1);
    expect(calls).toHaveLength(0);
    expect(messages.join("\n")).toContain("クロールが終わるまで待つ");
  });

  it("DELETE と INSERT を 1 つのファイルにまとめて 1 回で流す", () => {
    const now = Date.parse("2026-09-20T12:00:00.000Z");
    const { file, calls, deps } = setup("2026-09-20T00:00:00.000Z");
    expect(main(["--file", file, "--yes"], { ...deps, now })).toBe(0);

    expect(calls[0]).toEqual(["d1", "migrations", "apply", "DB", "--local"]);
    const execute = calls.find((args) => args.includes("--file"));
    expect(execute).toBeDefined();
    const staged = readFileSync(execute?.at(-1) ?? "", "utf8");
    // 子 (crawl_runs は親を持たないが名前順で後) も含めて全表を空にしてから入れる
    expect(staged).toContain('DELETE FROM "voice_actors";');
    expect(staged).toContain('DELETE FROM "crawl_runs";');
    expect(staged.indexOf("DELETE FROM")).toBeLessThan(staged.indexOf("INSERT INTO"));
    expect(staged).toContain(`INSERT INTO "voice_actors"`);
    // --persist-to を渡さない (E2E 用の D1 に触れない)
    expect(calls.flat()).not.toContain("--persist-to");
  });
});
