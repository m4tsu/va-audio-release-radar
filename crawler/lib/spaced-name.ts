/**
 * 日本語表記から、空白を入れた検索候補を作る。
 *
 * Audible のナレーター検索は名前によって空白の有無で結果が変わる
 * (実測: 「石見舞菜香」は該当なし、「石見 舞菜香」だと 2 件)。どこで切るのが正しいかは
 * 供給元の情報から分からないので、候補を作って adapter に順に試させる。
 *
 * 作った候補を台帳に保存しない。当てずっぽうの表記が別名義の表に入ると、
 * ストアのクレジット表記の照合がその表記でも当たるようになるため。使うのは検索のときだけ
 */

/**
 * 姓をこの文字数で切って空白を入れるか。名前の長さによって姓の文字数の相場が変わるため、
 * 日本語表記の長さで切り方を変える。
 *
 * - 2 文字 (「林勇」) → 1 文字切りしか作りようがない
 * - 3 文字 (「林大地」) → 1 文字切りと 2 文字切り (姓が 1 文字か 2 文字かは名前からは分からない)
 * - 4 文字以上 (「上田麗奈」) → 実測で正解の表記が 6/6 含まれた 2 文字切りと 3 文字切り
 *
 * どの長さでも候補は常に 2 個以下 (Audible への試行回数を増やさないため)
 */
function surnameCutLengthsFor(nameLength: number): readonly number[] {
  if (nameLength <= 2) return [1];
  if (nameLength === 3) return [1, 2];
  return [2, 3];
}

/** 「上田麗奈」→ ["上田 麗奈", "上田麗 奈"] */
export function spacedNameCandidates(canonicalName: string): string[] {
  // 「﨑」のような異体字やサロゲートペアを 1 文字として数えるため、コードポイントで割る
  const chars = [...canonicalName];
  const candidates: string[] = [];
  for (const cut of surnameCutLengthsFor(chars.length)) {
    if (chars.length <= cut) continue;
    candidates.push(`${chars.slice(0, cut).join("")} ${chars.slice(cut).join("")}`);
  }
  return candidates;
}
