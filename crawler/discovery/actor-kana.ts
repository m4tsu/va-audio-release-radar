import { readFile } from "node:fs/promises";
import path from "node:path";
import { CACHE_DIR } from "../lib/paths.ts";

/**
 * 取得した声優のかなの置き場所。
 *
 * 取得そのものは `wikipedia-kana.ts`、記事 HTML の解析は `wikipedia-article.ts`、
 * かなの文字列の形は `kana-text.ts`。対象声優リストを作る `build-actors.ts` はここだけを見るので、
 * 生成の側に取得の依存 (fetch / HTML 解析) が入らない
 */

export const KANA_JSON = path.join(CACHE_DIR, "discovery", "wikipedia-kana.json");

/**
 * 1 人ぶんの結果。取れなかった人も理由付きで残す。
 * 「引いたが取れなかった」と「まだ引いていない」を区別できないと、再開のたびに引き直してしまう
 */
export type ActorKanaRecord = {
  canonicalName: string;
  /** ok=かなが取れた / rejected=記事はあるが条件を満たさない / not-found=記事が無い / failed=取得に失敗 */
  status: "ok" | "rejected" | "not-found" | "failed";
  /** 保存する形のかな (空白なしのひらがな) */
  kana?: string;
  /** 記事に書かれていたままの値。取り違えを後から追えるようにする */
  rawKana?: string;
  source?: "furigana" | "kana-name";
  /** かなを取った、または最後に引いた記事名 */
  title?: string;
  /** 着地した記事名。転送されたかどうかが後から分かる */
  pageName?: string;
  reason?: string;
  /** HTTP ステータス。ネットワークエラーでは undefined */
  httpStatus?: number;
  fetchedAt: string;
};

export type ActorKanaCache = {
  startedAt: string;
  updatedAt: string;
  records: ActorKanaRecord[];
};

/** 取得済みのかな (canonicalName → かな)。`build-actors.ts` が対象声優リストに入れる */
export function kanaByCanonicalName(records: readonly ActorKanaRecord[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const record of records) {
    if (record.status === "ok" && record.kana !== undefined) {
      map[record.canonicalName] = record.kana;
    }
  }
  return map;
}

/**
 * 取得結果を読む。ファイルがまだ無ければ undefined (かな無しで生成できる)。
 *
 * 壊れた JSON と形の違う JSON は投げる。数時間かけた途中結果が壊れているのに
 * 黙って 0 人から引き直すと、気づかないまま同じ時間をもう一度使うことになる
 */
export async function readKanaCache(
  filePath: string = KANA_JSON,
): Promise<ActorKanaCache | undefined> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `${filePath} を JSON として読めない: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const records = (parsed as { records?: unknown })?.records;
  if (!Array.isArray(records)) throw new Error(`${filePath} に records 配列が無い`);
  return parsed as ActorKanaCache;
}

/**
 * まだ引いていない人を、引く順に返す。`limit` を渡すとその人数で切る。
 *
 * 全員だと数時間かかるので、人数を区切った実行を何度も重ねて進める。
 * 取得済みの人 (取れなかった人も含む) を飛ばさないと、実行のたびに先頭から引き直してしまう
 */
export function pendingNames(
  canonicalNames: readonly string[],
  records: readonly ActorKanaRecord[],
  limit?: number,
): string[] {
  const done = new Set(records.map((record) => record.canonicalName));
  const pending = canonicalNames.filter((name) => !done.has(name));
  return limit === undefined ? pending : pending.slice(0, limit);
}
