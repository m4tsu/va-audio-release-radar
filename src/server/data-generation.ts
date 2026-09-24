import { eq } from "drizzle-orm";
import { dataGeneration } from "./db/schema";
import type { AppDb } from "./db/types";

/**
 * クエリ結果のキャッシュ (`data-cache.ts`) のうち、Worker の実行環境に依存しない部分。
 * キーの組み立てと、データの世代の読み書き。単体テストから読めるよう `cloudflare:workers` を読み込まない
 */

/** キーに入れる引数。値は正規化して並べるので、呼び出し側のオブジェクトの形に依存しない */
export type QueryArgs = Record<string, string | number | boolean | readonly string[] | undefined>;

/**
 * キャッシュのキーにする URL。引数は名前順に並べ、`undefined` は落とす。
 * 自分のオリジンに置くのは、Cloudflare の管理画面からのキャッシュの全消去も届くようにするため
 */
export function cacheKeyUrl(
  origin: string,
  name: string,
  generation: string,
  date: string,
  args: QueryArgs,
): string {
  const params = new URLSearchParams({ g: generation, d: date });
  for (const field of Object.keys(args).sort()) {
    const value = args[field];
    if (value === undefined) continue;
    params.set(`a.${field}`, Array.isArray(value) ? JSON.stringify(value) : String(value));
  }
  return `${origin}/_data-cache/${encodeURIComponent(name)}?${params}`;
}

/** `DATA_CACHE` の値を読む。"1" のときだけ使う (空文字や未設定は使わない) */
export function dataCacheEnabled(value: string | undefined): boolean {
  return value?.trim() === "1";
}

/** 今の世代。行が無い DB (古い書き出しから戻したもの) でも動くよう、無ければ決まった値を返す */
export async function readDataGeneration(db: AppDb): Promise<string> {
  const [row] = await db
    .select({ generation: dataGeneration.generation })
    .from(dataGeneration)
    .where(eq(dataGeneration.id, 1));
  return row?.generation ?? "none";
}

/**
 * データの世代を新しくする。データを変えた書き込みの後に入口 (`src/worker.ts`) が呼ぶ。
 * 行が無くても作り直す
 */
export async function bumpDataGeneration(
  db: AppDb,
  now: string = new Date().toISOString(),
): Promise<void> {
  const generation = crypto.randomUUID();
  await db
    .insert(dataGeneration)
    .values({ id: 1, generation, updatedAt: now })
    .onConflictDoUpdate({ target: dataGeneration.id, set: { generation, updatedAt: now } });
}
