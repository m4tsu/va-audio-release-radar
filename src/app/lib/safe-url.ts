/**
 * 外部由来の URL を描画してよいか決める (R1 の指摘)。
 *
 * `productUrl` / `coverImageUrl` はストアの HTML / JSON から取った文字列で、
 * ingest の zod でも `https:` 限定にしてあるが、DB には検証を足す前に入った行が残りうる。
 * `javascript:` や `data:` を href / src に出すと、そこがそのままスクリプト実行の入口になるため、
 * 描画側でももう一度絞る。二重に見えるが、入口と出口のどちらか片方だけでは守り切れない
 */

/** `https:` の絶対 URL ならそのまま返し、それ以外は undefined。呼び出し側で「出さない」を選べる形にする */
export function safeHttpsUrl(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    // 相対 URL やゴミ文字列。外部ストアへのリンクは必ず絶対 URL なので弾いてよい
    return undefined;
  }
  return parsed.protocol === "https:" ? parsed.href : undefined;
}
