/**
 * E2E を動かす前にローカル環境を整える。Playwright の webServer から呼ばれる。
 *
 * CI のチェックアウト直後は `.wrangler/` も `.dev.vars` も無い (どちらも git 管理外)。
 * dev サーバーを上げる前にここで作っておかないと、テーブルが無い・管理画面のトークンが
 * 無いという理由で落ちる
 */
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** `.dev.vars.example` は値が空なので、E2E が期待する既定値でファイルを作る */
const DEV_VARS_DEFAULT = "INGEST_TOKEN=dev\nADMIN_TOKEN=dev-admin\n";

function run(command, args) {
  execFileSync(command, args, { cwd: repoRoot, stdio: "inherit" });
}

const devVarsPath = resolve(repoRoot, ".dev.vars");
if (existsSync(devVarsPath)) {
  // 開発者が自分で置いたものは触らない
  console.log("[e2e] .dev.vars は既にある");
} else {
  writeFileSync(devVarsPath, DEV_VARS_DEFAULT);
  console.log("[e2e] .dev.vars を既定値で作成した");
}

run("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--local"]);
run("npx", ["wrangler", "d1", "execute", "DB", "--local", "--file", "e2e/fixtures/seed.sql"]);
