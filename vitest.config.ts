import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * 単体テストのみ。TanStack Start / Cloudflare のプラグインはここでは読み込まない。
 * それらは workerd 用の環境を差し込むため、jsdom / node のテストとは両立しない
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: [
            "src/domain/**/*.test.ts",
            "src/server/**/*.test.ts",
            "crawler/**/*.test.ts",
            "scripts/**/*.test.ts",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "app",
          environment: "jsdom",
          include: ["src/app/**/*.test.{ts,tsx}"],
          setupFiles: ["./src/app/test-setup.ts"],
        },
      },
    ],
  },
});
