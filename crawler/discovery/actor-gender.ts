import { readFile } from "node:fs/promises";
import path from "node:path";
import type { VoiceActorGender } from "../../src/domain/index.ts";
import { CACHE_DIR } from "../lib/paths.ts";

/**
 * staff id から引いた性別の置き場所。
 *
 * 取得そのものは `anilist-gender.ts`。リストに書き入れる `fill-actor-gender.ts` はここだけを見るので、
 * 書き入れる側に取得の依存 (fetch / GraphQL) が入らない。かなの `actor-kana.ts` と同じ形。
 *
 * 作品からの取得 (`anilist.ts` の集計) はシーズンの窓に入った声優しか通らない。
 * 窓から外れた声優は前回の出力から引き継がれるだけで性別を引く機会が無いので、
 * リストにいる全員へ staff id で届くこの経路を別に持つ
 */

export const GENDER_JSON = path.join(CACHE_DIR, "discovery", "anilist-gender.json");

/** 引く相手。名前は突き合わせと記録のために持ち、問い合わせの鍵は staff id */
export type GenderTarget = { anilistStaffId: number; canonicalName: string };

/**
 * 1 人ぶんの結果。性別が取れなかった人も理由付きで残す。
 *
 * `absent` (問い合わせたが AniList が性別を持っていない) と、記録が無いこと (まだ問い合わせていない) を
 * 分けられないと、「その他」と「不明」が同じ籠に入ったままなのか、引けば埋まるのかが区別できない
 */
export type ActorGenderRecord = {
  anilistStaffId: number;
  canonicalName: string;
  /** ok=性別が返った / absent=問い合わせたが値を持たない / not-found=staff id が返らない / failed=取得に失敗 */
  status: "ok" | "absent" | "not-found" | "failed";
  /** 列挙に写した性別。status が ok のときだけ入る */
  gender?: VoiceActorGender;
  /** AniList が返した生の文字列。自由記述なので、写し間違いを後から追えるように残す */
  rawGender?: string;
  /** AniList 側の日本語表記。staff id と名前の対応がずれていないかを後から確かめられる */
  nativeName?: string;
  reason?: string;
  /** HTTP ステータス。ネットワークエラーでは undefined */
  httpStatus?: number;
  fetchedAt: string;
};

export type ActorGenderCache = {
  startedAt: string;
  updatedAt: string;
  records: ActorGenderRecord[];
};

/** 取得済みの性別 (staff id → 性別)。`fill-actor-gender.ts` が対象声優リストに書き入れる */
export function genderByStaffId(
  records: readonly ActorGenderRecord[],
): Record<number, VoiceActorGender> {
  const map: Record<number, VoiceActorGender> = {};
  for (const record of records) {
    if (record.status === "ok" && record.gender !== undefined) {
      map[record.anilistStaffId] = record.gender;
    }
  }
  return map;
}

/**
 * AniList に一度は問い合わせが届いた staff id。
 *
 * `failed` を入れないのは、相手の答えを受け取れていないため。「性別を持っていない」と
 * 言えるのは `absent` と `not-found` だけで、取得に失敗した人はまだ問い合わせていないのと同じ扱いにする
 */
export function queriedStaffIds(records: readonly ActorGenderRecord[]): Set<number> {
  const ids = new Set<number>();
  for (const record of records) {
    if (record.status !== "failed") ids.add(record.anilistStaffId);
  }
  return ids;
}

/**
 * 取得結果を読む。ファイルがまだ無ければ undefined (性別無しで生成できる)。
 *
 * 壊れた JSON と形の違う JSON は投げる。途中結果が壊れているのに黙って 0 人から引き直すと、
 * 引き直した人数ぶんのリクエストを相手にもう一度投げることになる
 */
export async function readGenderCache(
  filePath: string = GENDER_JSON,
): Promise<ActorGenderCache | undefined> {
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
  return parsed as ActorGenderCache;
}

/**
 * まだ引いていない人を、引く順に返す。`limit` を渡すとその人数で切る。
 *
 * 飛ばすのは `queriedStaffIds` が問い合わせ済みと見なす人だけ。取得に失敗した人を飛ばすと、
 * 429 で止まった続きから再開したときにその人たちが二度と引かれず、
 * 答えを受け取れていないまま「問い合わせ済み」として埋もれる。
 *
 * 同じ staff id が 2 回来ることがある (対象声優リストと staff 集計の両方に居る人) ので、
 * 入力のほうも staff id で重複を落とす
 */
export function pendingTargets(
  targets: readonly GenderTarget[],
  records: readonly ActorGenderRecord[],
  limit?: number,
): GenderTarget[] {
  const done = queriedStaffIds(records);
  const pending: GenderTarget[] = [];
  for (const target of targets) {
    if (done.has(target.anilistStaffId)) continue;
    done.add(target.anilistStaffId);
    pending.push(target);
  }
  return limit === undefined ? pending : pending.slice(0, limit);
}
