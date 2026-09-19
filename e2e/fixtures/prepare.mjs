/**
 * E2E を動かす前にローカル環境を整える。Playwright の webServer から呼ばれる。
 *
 * CI のチェックアウト直後は `.wrangler-e2e/` も `.dev.vars` も無い (どちらも git 管理外)。
 * dev サーバーを上げる前にここで作っておかないと、テーブルが無い・管理画面のトークンが
 * 無いという理由で落ちる。
 *
 * 触るのは E2E 専用の D1 だけ。開発用の `.wrangler/state` には読み書きしない (e2e-db.mjs)
 */
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { E2E_PERSIST_TO, migrate, repoRoot, reset, seed } from "./e2e-db.mjs";

/** `.dev.vars.example` は値が空なので、E2E が期待する既定値でファイルを作る */
const DEV_VARS_DEFAULT = "INGEST_TOKEN=dev\nADMIN_TOKEN=dev-admin\n";

const devVarsPath = resolve(repoRoot, ".dev.vars");
if (existsSync(devVarsPath)) {
  // 開発者が自分で置いたものは触らない
  console.log("[e2e] .dev.vars は既にある");
} else {
  writeFileSync(devVarsPath, DEV_VARS_DEFAULT);
  console.log("[e2e] .dev.vars を既定値で作成した");
}

console.log(`[e2e] E2E 用 D1: ${E2E_PERSIST_TO}`);
// 毎回まっさらから作る。使い回すと、seed.sql から消した行や古いマイグレーションの痕跡が
// 残り、まっさらな CI とローカルで結果が変わる。固定データは数十行なので作り直しても一瞬
reset();
migrate();
seed();
