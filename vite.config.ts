import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    // Playwright の webServer と手動確認で同じポートを使うため、既定ポートを固定する
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
    cloudflare({ viteEnvironment: { name: "ssr" } }),
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
