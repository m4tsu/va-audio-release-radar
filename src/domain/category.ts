import type { StoreSlug, WorkCategory } from "./types.ts";

/**
 * ストア固有の分類・ジャンルからアプリ内カテゴリを決める。
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
 * 2. ポケドラは商品カテゴリだけで決める (`categorizePokedora`)
 * 3. DLsite の `SOU` 以外 (`MUS` など) は other
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

/**
 * ポケドラの商品カテゴリのうち、ドラマ CD を指すもの。
 * `BLCD` はポケドラでいちばん多いカテゴリで、中身はドラマ CD (ストア横断調査 §1)
 */
const POKEDORA_DRAMA_WORDS = ["ドラマCD", "BLCD", "ボイスドラマ", "オーディオドラマ"];

/**
 * ポケドラの商品カテゴリのうち、ドラマでも ASMR でもないもの。
 * 中身はキャラクターソング CD (「【DIG-ROCK】RESISTANCE【Vo.AKANE（CV.古川慎）】」など)
 */
const POKEDORA_OTHER_WORDS = ["音楽"];

export function categorize(
  storeSlug: StoreSlug,
  storeCategory?: string,
  genres?: string[],
  titleRaw?: string,
): WorkCategory {
  if (storeSlug === "audible") return "audiobook";
  if (storeSlug === "pokedora") return categorizePokedora(storeCategory);
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

/**
 * ポケドラの商品カテゴリ (`span.product_catgory_el` の先頭) だけで区分を決める。
 *
 * 実データ 492 件の内訳は BLCD 351 / 一般ドラマCD 76 / シチュエーションCD 35 /
 * 音楽 17 / 女性向けドラマCD 11 / 配信限定シチュエーション 2 の 6 種類だった。
 *
 * DLsite と違ってジャンルとタイトルを見ないのは、ポケドラの商品カテゴリがストア自身の
 * 売り場区分で、それだけで答えが出るため。関連ワード (genres に入れている) のほうは
 * 「あまあま」「学園」のような内容の語で、区分の材料にならない。実際、ASMR の語を含む
 * 3 件はいずれもシチュエーション系のカテゴリに置かれており、カテゴリだけで正しく決まる。
 *
 * 既定を audio_drama にしてあるのは、ポケドラがドラマ CD のストアで、上の 6 種類のうち
 * 4 種類がドラマ系だから (DLsite 全年齢音声の既定を asmr にしてあるのと同じ理屈)
 */
function categorizePokedora(storeCategory: string | undefined): WorkCategory {
  const category = storeCategory ?? "";
  if (includesAny([category], POKEDORA_OTHER_WORDS)) return "other";
  if (includesAny([category], SITUATION_WORDS)) return "situation_voice";
  if (includesAny([category], POKEDORA_DRAMA_WORDS)) return "audio_drama";
  return "audio_drama";
}

function includesAny(values: readonly string[], words: readonly string[]): boolean {
  return values.some((value) => words.some((word) => value.includes(word)));
}
