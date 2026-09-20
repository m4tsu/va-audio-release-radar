/**
 * LIKE のワイルドカードを落とす。検索語に "%" や "_" が入ったときに全件一致にならないようにする。
 * SQLite の ESCAPE 句は drizzle の `like` から渡せないので、エスケープではなく除去で済ませる
 */
export function stripLikeWildcards(value: string): string {
  return value.replace(/[%_]/g, "");
}
