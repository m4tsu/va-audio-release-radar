import { defineConfig, devices } from "@playwright/test";

// E2E 専用のポート。開発用の 5199 や他のセッションが使うポートとは重ねない。
// 同じポートを使うと reuseExistingServer が他人のサーバーを掴んでしまう
const port = 5399;

// E2E 専用の D1 の置き場。e2e/fixtures/e2e-db.mjs の既定値と必ず同じにすること。
// dev サーバー (vite.config.ts の persistState) と wrangler の両方にこの値で渡る
const persistTo = ".wrangler-e2e/state";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  // vite dev はモジュールを初回アクセス時に変換する。最初の数件はそれを待つぶん遅い
  timeout: 60_000,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
    locale: "ja-JP",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // TanStack Start は SSR なので dev サーバー経由で E2E する (静的 preview では API が動かない)。
    // 先に e2e:prepare で E2E 専用 D1 を作り直し、マイグレーションと固定データの投入を済ませる
    // (.wrangler-e2e/ は git 管理外なので、CI では何もない状態から始まる)
    // exec で sh を vite に置き換える。npx や sh を挟むと Playwright が送る停止信号が
    // ラッパー止まりになり、vite と子の workerd が親を失って居座る
    command: `npm run e2e:prepare && exec ./node_modules/.bin/vite dev --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    // 既に上がっているサーバーには相乗りしない。他のセッションが同じポートで
    // 開発用 D1 を見ている dev サーバーを乗っ取ると、そちらに固定データが流れ込む
    reuseExistingServer: false,
    env: { RADAR_PERSIST_TO: persistTo },
    timeout: 120_000,
  },
});
