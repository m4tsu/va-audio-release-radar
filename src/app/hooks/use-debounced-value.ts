import { useEffect, useState } from "react";

/**
 * 入力が止まってから値を遅らせて返す。
 * 検索ボックスの 1 文字ごとに server function を呼ばないようにするために使う
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
