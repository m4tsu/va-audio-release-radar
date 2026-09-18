import { defineConfig, devices } from "@playwright/test";

const port = 5199;

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
    // 先に e2e:prepare でローカル D1 のマイグレーションと固定データの投入を済ませる
    // (.wrangler/ は git 管理外なので、CI では何もない状態から始まる)
    command: `npm run e2e:prepare && npx vite dev --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
