import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// ローカルの D1 / KV などを置く場所。既定は @cloudflare/vite-plugin の `.wrangler/state`。
// E2E は開発用の実データを壊さないよう、RADAR_PERSIST_TO で専用のディレクトリに逃がす
// (playwright.config.ts と e2e/fixtures/e2e-db.mjs が同じ値を wrangler の --persist-to にも渡す)。
// 型は PluginConfig["persistState"] = boolean | { path: string }
const persistTo = process.env.RADAR_PERSIST_TO;

export default defineConfig({
  server: {
    // 手動確認の入口を固定する。E2E は別ポート (playwright.config.ts の 5399) と
    // 別の D1 を使うので、ここと衝突させない
    port: 5199,
    watch: {
      // クローラーのスナップショット置き場。クロール中に何百ファイルも書かれ、
      // その再読み込みで vite dev が落ちた (T5)。ソースではないので監視から外す
      ignored: ["**/crawler/.cache/**"],
    },
  },
  plugins: [
    // プラグインの順序は変えないこと。
    // cloudflare が "ssr" 環境を workerd に差し替えてから tanstackStart がその環境に載り、
    // tanstackStart のルート生成・コンパイルが終わってから react が JSX を変換する
    cloudflare({
      viteEnvironment: { name: "ssr" },
      // true は既定と同じ意味 (.wrangler/state を使う)
      persistState: persistTo ? { path: persistTo } : true,
    }),
    tanstackStart({
      router: {
        // routesDirectory / generatedRouteTree は srcDirectory (既定 "src") からの相対パス
        routesDirectory: "app/routes",
        generatedRouteTree: "app/routeTree.gen.ts",
      },
      // src/server/** は D1 バインディングを触るサーバー専用コード。
      // クライアントバンドルに紛れ込むとビルドが通ってしまい実行時まで気づけないため、
      // 既定の **/*.server.* に加えてディレクトリごとクライアントから遮断する
      importProtection: {
        enabled: true,
        client: {
          specifiers: ["cloudflare:workers"],
          files: ["**/*.server.*", "src/server/**"],
        },
      },
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
