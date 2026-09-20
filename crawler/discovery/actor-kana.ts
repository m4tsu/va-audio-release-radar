import { readFile } from "node:fs/promises";
import path from "node:path";
import { CACHE_DIR } from "../lib/paths.ts";

/**
 * 取得した声優のかなの形と置き場所。
 *
 * 取得そのものは `wikipedia-kana.ts`、記事 HTML の解析は `wikipedia-article.ts`。
 * 対象声優リストを作る `build-actors.ts` はここだけを見るので、
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

// --- かなの形 --------------------------------------------------------------

/** カタカナの範囲 (ァ〜ヶ)。ひらがなとは 0x60 ずれている */
const KATAKANA_START = 0x30a1;
const KATAKANA_END = 0x30f6;
const KANA_OFFSET = 0x60;
/** 空白と中黒は落とす。手で書いた既存のかなも、どちらも入れない形で持っている */
const SEPARATORS = /[\s・･]+/gu;
/** 保存してよい形。ひらがなと長音符だけ */
const HIRAGANA_ONLY = /^[ぁ-ゖー]+$/u;

/**
 * 記事の値を保存する形に直す。区切りを落とし、カタカナをひらがなに寄せる。
 *
 * Wikipedia は姓と名の間に空白を入れ、名前がラテン文字の声優にはカタカナの読みを載せる。
 * `src/domain/normalize.ts` の `normalizeName` は空白と中黒を落とすがかなとカナは畳まないので、
 * カタカナのまま入れるとひらがなで引いた検索に当たらない。
 * ひらがなと長音符以外が残る値は、読みとして取り出せていないので捨てる
 */
export function toStoredKana(raw: string): string | undefined {
  const plain = raw
    // 脚注より後ろは読みではない
    .replace(/<ref[\s\S]*$/i, "")
    .replace(/\{\{[\s\S]*?\}\}/g, "")
    // 内部リンクは表示側だけ残す ([[のがみ ゆかな|ゆかな]] → ゆかな)
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(SEPARATORS, "");

  let hiragana = "";
  for (const character of plain) {
    const code = character.codePointAt(0) ?? 0;
    hiragana +=
      code >= KATAKANA_START && code <= KATAKANA_END
        ? String.fromCodePoint(code - KANA_OFFSET)
        : character;
  }
  return HIRAGANA_ONLY.test(hiragana) ? hiragana : undefined;
}
