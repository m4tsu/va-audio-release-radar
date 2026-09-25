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
          // src はディレクトリを列挙せず app 以外をすべて拾う。足したディレクトリのテストが黙って走らないのを防ぐ
          include: ["src/**/*.test.ts", "crawler/**/*.test.ts", "scripts/**/*.test.ts"],
          exclude: ["src/app/**", "**/node_modules/**"],
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
