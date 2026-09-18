/**
 * SQL の IN 句に並べる値を分割する。
 *
 * D1 (Workers Binding API) が 1 文に渡せる bound parameter は 100 個まで。
 * IN 句の値はそのまま bound parameter になるので、ここを超えると実行時に失敗する。
 * 単体テストは libsql (上限がずっと大きい) で走るため、テストでは検知できない。
 * 上限ぴったりではなく 90 にしてあるのは、同じ文に IN 句以外の bind (期間の下限や
 * limit など) が数個付くため。works / admin / actors のすべての IN 句でこれを通す
 */
export const SQL_IN_CHUNK_SIZE = 90;

/** D1 の bound parameter 上限。これを超える IN 句を作ってはいけない */
export const D1_MAX_BOUND_PARAMETERS = 100;

/**
 * `items` を最大 `size` 件ずつに切る。空配列なら空配列 (IN 句を組まずに済ませられる)。
 * `size` は 1 以上でなければ無限ループになるため、下回る指定は 1 に丸める
 */
export function chunked<T>(items: readonly T[], size: number = SQL_IN_CHUNK_SIZE): T[][] {
  const step = Math.max(1, Math.floor(size));
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += step) {
    chunks.push(items.slice(i, i + step));
  }
  return chunks;
}
