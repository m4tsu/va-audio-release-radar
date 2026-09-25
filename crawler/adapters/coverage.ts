import type { Coverage } from "./types.ts";

/**
 * 網羅率の組み立て。DLsite と Audible が使う。
 *
 * 総件数が取れなかったときは `total` も `complete` も入れない。
 * 「総件数は分からないが全部取れた」とは言えず、undefined のままにしておけば
 * 管理画面でも「不明」として出せるため (types.ts の Coverage 参照)
 */
export function buildCoverage(fetched: number, total: number | undefined, pages: number): Coverage {
  if (total === undefined) return { fetched, pages };
  return { fetched, total, complete: fetched >= total, pages };
}
