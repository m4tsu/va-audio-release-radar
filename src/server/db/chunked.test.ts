import { describe, expect, test } from "vitest";
import { chunked, D1_MAX_BOUND_PARAMETERS, SQL_IN_CHUNK_SIZE } from "./chunked";

describe("chunked", () => {
  test("空配列はチャンクを作らない", () => {
    expect(chunked([])).toEqual([]);
  });

  test("上限以下ならそのまま 1 チャンク", () => {
    const ids = Array.from({ length: SQL_IN_CHUNK_SIZE }, (_, i) => i);
    expect(chunked(ids)).toEqual([ids]);
  });

  test("上限を超えたら分割し、元の並びと件数を保つ", () => {
    const ids = Array.from({ length: SQL_IN_CHUNK_SIZE * 2 + 3 }, (_, i) => i);
    const chunks = chunked(ids);

    expect(chunks).toHaveLength(3);
    expect(chunks.flat()).toEqual(ids);
    expect(chunks.at(-1)).toHaveLength(3);
  });

  /**
   * D1 の bound parameter 上限を超えないことの固定。
   * 超えると本番だけ実行時に落ちる (単体テストの libsql では通ってしまう)
   */
  test("どのチャンクも D1 の bound parameter 上限を超えない", () => {
    const ids = Array.from({ length: 1000 }, (_, i) => `id-${i}`);
    for (const chunk of chunked(ids)) {
      expect(chunk.length).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMETERS);
    }
    expect(SQL_IN_CHUNK_SIZE).toBeLessThan(D1_MAX_BOUND_PARAMETERS);
  });

  test("size を明示できる。1 未満は 1 に丸める", () => {
    expect(chunked([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
    expect(chunked([1, 2], 0)).toEqual([[1], [2]]);
  });
});
