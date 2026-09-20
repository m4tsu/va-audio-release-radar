/**
 * かなの文字列を保存する形に直す純粋関数。fs も fetch も触らない。
 *
 * 取得結果の置き場所は `actor-kana.ts`、記事 HTML の解析は `wikipedia-article.ts`
 */

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
