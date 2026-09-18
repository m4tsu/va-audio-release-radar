import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

/**
 * D1 バインディングから Drizzle のクライアントを作る。
 *
 * Workers の env はリクエスト単位で注入されるため、モジュール先頭で `env.DB` を取り出して
 * 定数に固定してはいけない。呼ぶたびに参照する (drizzle 自体の生成は軽い)。
 * このファイルは vite.config.ts の importProtection でクライアントから import できない
 */
export function getDb() {
  return drizzle(env.DB, { schema });
}

export type Db = ReturnType<typeof getDb>;
