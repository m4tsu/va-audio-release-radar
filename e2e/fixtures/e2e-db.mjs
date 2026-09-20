/**
 * E2E 専用のローカル D1 を作り直す。`npm run db:*:e2e` と `e2e/fixtures/prepare.mjs` の実体。
 *
 * 開発用の `.wrangler/state` とは別のディレクトリに置く。同じ場所を使うと、開発者が
 * ブラウザで見ている実データに固定データが混ざり、消し漏れればそのまま残る。
 * 開発用 D1 を戻すには他のセッションの作業を止めることになるので、E2E からは一切触らせない
 * (CLAUDE.md の「ローカルの共有資源」)
 */
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * wrangler の `--persist-to` と @cloudflare/vite-plugin の `persistState.path` に渡す値。
 * 両者とも渡されたパスの下に `v3/d1/...` を掘るので、同じ値なら同じ DB を指す
 * (プラグイン側は dist/index.mjs の getPersistenceRoot が `path.resolve(root, path, "v3")`)。
 *
 * playwright.config.ts が webServer の env で RADAR_PERSIST_TO として同じ値を渡す。
 * 環境変数が無いとき (手で `npm run db:seed:e2e` を叩いたとき) は既定値を使う
 */
export const E2E_PERSIST_TO = process.env.RADAR_PERSIST_TO ?? ".wrangler-e2e/state";

function wrangler(args) {
  execFileSync("npx", ["wrangler", ...args, "--persist-to", E2E_PERSIST_TO], {
    cwd: repoRoot,
    stdio: "inherit",
  });
}

/**
 * E2E 用の永続化ディレクトリを丸ごと消す。
 *
 * 消す先が本当に E2E 用かを毎回確かめる。ここのパスを間違えると開発用の実データが消え、
 * それは取り返しがつかない
 */
export function reset() {
  const target = resolve(repoRoot, E2E_PERSIST_TO);
  const devState = resolve(repoRoot, ".wrangler", "state");
  if (!target.startsWith(repoRoot + sep)) {
    throw new Error(`[e2e] 永続化ディレクトリがリポジトリの外を指している: ${target}`);
  }
  if (target === devState || devState.startsWith(target + sep)) {
    throw new Error(`[e2e] 開発用の ${devState} を消そうとしている: ${target}`);
  }
  rmSync(target, { recursive: true, force: true });
  console.log(`[e2e] ${E2E_PERSIST_TO} を消した`);
}

export function migrate() {
  wrangler(["d1", "migrations", "apply", "DB", "--local"]);
}

export function seed() {
  wrangler(["d1", "execute", "DB", "--local", "--file", "e2e/fixtures/seed.sql"]);
}

const COMMANDS = { reset, migrate, seed };

// npm scripts から `node e2e/fixtures/e2e-db.mjs <command>` で呼ぶ。
// import されたとき (prepare.mjs) には走らせない
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = COMMANDS[process.argv[2]];
  if (!command) {
    console.error(`使い方: node e2e/fixtures/e2e-db.mjs <${Object.keys(COMMANDS).join("|")}>`);
    process.exit(1);
  }
  command();
}
