// scripts/d1-export-local.test.ts
//
// 実際のローカル D1 には触れない。一時ディレクトリに作った sqlite を D1 に見立てて、
// CLI が既定で Audible を除くこと、--include-store でその除外を外せることを確かめる。
// ここが壊れると、robots.txt が禁じる URL から取った行が本番へ入る

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "./d1-export-local.mjs";

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

function setup() {
  tempDir = mkdtempSync(path.join(tmpdir(), "d1-export-test-"));
  const d1StateDir = path.join(tempDir, "d1");
  mkdirSync(d1StateDir);
  const db = new DatabaseSync(path.join(d1StateDir, "db.sqlite"));
  db.exec(`
    CREATE TABLE audio_works (id TEXT PRIMARY KEY, title TEXT NOT NULL);
    CREATE TABLE store_listings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      audio_work_id TEXT NOT NULL REFERENCES audio_works(id),
      store_slug TEXT NOT NULL
    );
    INSERT INTO audio_works VALUES ('dlsite:RJ1', 'a'), ('audible:B1', 'b');
    INSERT INTO store_listings (audio_work_id, store_slug) VALUES
      ('dlsite:RJ1', 'dlsite'), ('audible:B1', 'audible');
  `);
  db.close();
  const output = path.join(tempDir, "out.sql");
  const messages: string[] = [];
  const deps = {
    d1StateDir,
    log: (message: string) => messages.push(message),
    error: (message: string) => messages.push(message),
  };
  return { output, messages, deps };
}

describe("main", () => {
  it("既定で Audible の行を除き、除いたストアを出す", () => {
    const { output, messages, deps } = setup();
    expect(main(["--output", output], deps)).toBe(0);

    const sql = readFileSync(output, "utf8");
    expect(sql).toContain("dlsite:RJ1");
    expect(sql).not.toContain("audible:B1");
    expect(messages.join("\n")).toContain("除いたストア: audible");
  });

  it("--include-store audible を渡すと除外を外す", () => {
    const { output, messages, deps } = setup();
    expect(main(["--output", output, "--include-store", "audible"], deps)).toBe(0);

    const sql = readFileSync(output, "utf8");
    expect(sql).toContain("audible:B1");
    expect(messages.join("\n")).not.toContain("除いたストア");
  });

  it("手元の D1 が無ければ止まる", () => {
    const { output, messages, deps } = setup();
    const missing = { ...deps, d1StateDir: path.join(tempDir ?? "", "nothing") };
    expect(main(["--output", output], missing)).toBe(1);
    expect(messages.join("\n")).toContain("手元の D1 が無い");
  });
});
