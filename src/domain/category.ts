import type { StoreSlug, WorkCategory } from "./types.ts";

/**
 * ストア固有の分類・ジャンルからアプリ内カテゴリを決める (設計書 §4)。
 *
 * 規則は実データから決め直した。`crawler/.cache/snapshots/dlsite/` に貯めた
 * product.json 200 件を数えたところ:
 *
 * - `work_type` は 200 件すべて `SOU`。全年齢音声で別の種別はほぼ出てこない
 * - 上位ジャンルは ASMR 155 / バイノーラル・ダミヘ 138 / 癒し 134 / 耳かき 109 /
 *   萌え 65 / ささやき 64 で、ASMR 系の語が圧倒的に多い
 * - DLsite のジャンルには「ドラマ」「シチュエーション」という語が 1 件も無い。
 *   つまり旧規則 (ジャンルだけを見る) では 200 件すべてが asmr になっていた
 * - 一方でタイトルには「ボイスドラマ」「ドラマCD」が入っている作品が 19 件あり、
 *   ドラマ作品を見分けられるのはタイトルだけだった
 *
 * そこで判定材料をジャンル + タイトルに広げ、次の順で決める:
 *
 * 1. Audible はすべて audiobook (朗読以外の判定はしない)
 * 2. DLsite の `SOU` 以外 (`MUS` など) は other
 * 3. ジャンルかタイトルに「ボイスドラマ」「ドラマCD」「オーディオドラマ」→ audio_drama
 * 4. ジャンルに「ドラマ」を含む語 → audio_drama (DLsite が将来ジャンルを持った場合の受け)
 * 5. ジャンルかタイトルに ASMR 系の語 → asmr
 * 6. ジャンルかタイトルに「シチュエーション」系の語 → situation_voice
 * 7. どれにも当たらなければ asmr (DLsite 全年齢音声の大半が ASMR のため)
 *
 * 3 を 5 より先に見るのは、「ASMR」ジャンルが付いたボイスドラマがあるため。
 * 逆に「ASMRおやすみドラマ」のようにタイトルへ「ドラマ」だけが入る ASMR 作品もあるので、
 * タイトル側では複合語 (ボイスドラマ / ドラマCD) しか拾わない。
 * この規則を 200 件に当てると asmr 181 / audio_drama 19 になる
 */

/** ドラマと断定できる複合語。単独の「ドラマ」はタイトルでは拾わない (誤判定が出るため) */
const DRAMA_COMPOUND_WORDS = ["ボイスドラマ", "ドラマCD", "オーディオドラマ"];

/** ASMR 系。DLsite のジャンル名は「ささやき」「バイノーラル/ダミヘ」のように表記が固いのでそのまま並べる */
const ASMR_WORDS = [
  "ASMR",
  "耳かき",
  "耳ふー",
  "耳舐め",
  "ささやき",
  "囁き",
  "囁",
  "バイノーラル",
  "ダミヘ",
  "安眠",
  "睡眠",
  "添い寝",
  "マッサージ",
  "催眠音声",
];

/** シチュエーションボイス系 */
const SITUATION_WORDS = ["シチュエーション", "シチュボ"];

export function categorize(
  storeSlug: StoreSlug,
  storeCategory?: string,
  genres?: string[],
  titleRaw?: string,
): WorkCategory {
  if (storeSlug === "audible") return "audiobook";
  if (storeSlug !== "dlsite" || storeCategory !== "SOU") return "other";

  const genreList = genres ?? [];
  // タイトルも判定材料に入れる。DLsite のジャンルにはドラマを表す語が無いため
  const haystack = titleRaw ? [...genreList, titleRaw] : genreList;

  if (includesAny(haystack, DRAMA_COMPOUND_WORDS)) return "audio_drama";
  if (includesAny(genreList, ["ドラマ"])) return "audio_drama";
  if (includesAny(haystack, ASMR_WORDS)) return "asmr";
  if (includesAny(haystack, SITUATION_WORDS)) return "situation_voice";
  return "asmr";
}

function includesAny(values: readonly string[], words: readonly string[]): boolean {
  return values.some((value) => words.some((word) => value.includes(word)));
}
