import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit の設定。`npm run db:generate` でスキーマの差分から migrations/*.sql を出し、
 * 適用は wrangler 側 (`npm run db:migrate:local` / `db:migrate:remote`) に任せる。
 * drizzle-kit から D1 へ直接つながないため dbCredentials は置かない
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/db/schema.ts",
  out: "./migrations",
});
