import type { AnimeSeason } from "./types.ts";

/**
 * 日時からアニメのシーズンを決める。画面 (`/anime` の先頭) とクローラー (週次の対象シーズン) が
 * 同じ規則で「今」を決めるよう、ここ 1 か所に置く。
 */

/** 年とシーズンだけを持つもの。前後を決めるのに要るのはこの 2 つだけ */
export type SeasonKey = { seasonYear: number; season: AnimeSeason };

/** 日本時間と UTC の差 */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * その時点で放送中のシーズン。1〜3 月が冬、4〜6 月が春、7〜9 月が夏、10〜12 月が秋。
 *
 * 日本時間の暦日で決める。UTC のままだと 10 月 1 日の朝 9 時まで夏のままになる。
 * `getMonth()` のような時刻帯ごとに変わる読み方をしないのは、動かす場所
 * (Workers と GitHub Actions は UTC、手元は地域の時刻帯) で結果を変えないため
 */
export function seasonAt(now: Date): SeasonKey {
  if (Number.isNaN(now.getTime())) throw new Error("日時として読めない");
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  return { seasonYear: jst.getUTCFullYear(), season: seasonOfMonth(jst.getUTCMonth()) };
}

/** 0 起点の月 (0 = 1 月) からシーズンを決める */
function seasonOfMonth(month: number): AnimeSeason {
  if (month < 3) return "WINTER";
  if (month < 6) return "SPRING";
  if (month < 9) return "SUMMER";
  return "FALL";
}
