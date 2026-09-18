/**
 * `npm run test:e2e` の実体。
 *
 * Playwright の webServer (`e2e:prepare`) は毎回 `seed.sql` を流すので、テストが終わった後の
 * ローカル D1 には E2E の固定データ (テスト声優アルファ / ベータとその作品・listing・credit・
 * crawl_runs) が残ったままになる。テストが失敗して途中で止まっても後片付けだけは必ず走らせたいので、
 * ここで Playwright を子プロセスとして起動し、成否に関わらず finally で `db:seed:e2e:clean` を流す。
 * `playwright test ; npm run db:seed:e2e:clean` のように `;` で繋ぐと片付けは走るが、
 * その場合 npm スクリプト全体の終了コードが後者 (clean) のものになり、テスト失敗が CI に伝わらない
 */
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function run(command, args) {
  execFileSync(command, args, { cwd: repoRoot, stdio: "inherit" });
}

let exitCode = 0;
try {
  run("npx", ["playwright", "test"]);
} catch (error) {
  // execFileSync は非 0 終了で例外を投げる。終了コードを保って後で反映する
  exitCode = typeof error.status === "number" ? error.status : 1;
} finally {
  try {
    run("npm", ["run", "db:seed:e2e:clean"]);
  } catch (cleanupError) {
    console.error("[e2e] db:seed:e2e:clean に失敗した", cleanupError);
    // 片付けの失敗でテスト結果の成否を上書きしない。ただし何も失敗していなければ気付けるようにする
    if (exitCode === 0) exitCode = 1;
  }
}

process.exit(exitCode);
