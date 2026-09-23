import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { toProbeResult } from "./delist.ts";
import { FIXTURES_DIR } from "./lib/paths.ts";

/**
 * 台帳の作品を引き直したときの判定。ネットワークには出ない。
 *
 * 見るのは「判定を付けるかどうか」。付けた判定は台帳をそのまま書き換えるので、
 * 読めなかったものを false ("買える") に倒すと、前に付いた取り下げが取り消される
 */

const onSaleJson = readFileSync(path.join(FIXTURES_DIR, "dlsite-product-RJ01698658.json"), "utf8");

/** フィクスチャの `on_sale` だけ差し替える。他の項目は実データのまま */
function withOnSale(value: unknown): string {
  const parsed = JSON.parse(onSaleJson) as Array<Record<string, unknown>>;
  const [first] = parsed;
  if (first === undefined) throw new Error("fixture が空");
  if (value === undefined) delete first.on_sale;
  else first.on_sale = value;
  return JSON.stringify(parsed);
}

describe("toProbeResult", () => {
  it("販売中の作品は取り下げない", () => {
    expect(toProbeResult("RJ01698658", onSaleJson)).toEqual({
      storeProductId: "RJ01698658",
      delisted: false,
    });
  });

  it("買えなくなった作品は取り下げる", () => {
    expect(toProbeResult("RJ01698658", withOnSale(0))).toEqual({
      storeProductId: "RJ01698658",
      delisted: true,
    });
  });

  it("on_sale が無い作品は判定を付けない", () => {
    const result = toProbeResult("RJ01698658", withOnSale(undefined));

    expect(result.delisted).toBeUndefined();
    expect(result.reason).toBeDefined();
  });

  /**
   * R18 のフロアにしか無い作品は `/home/` の API では空配列が返る
   * (`docs/stores/dlsite.md`)。「引けない」であって「買えない」ではない
   */
  it("空配列が返る作品は判定を付けない", () => {
    const result = toProbeResult("RJ01698658", "[]");

    expect(result.delisted).toBeUndefined();
    expect(result.reason).toBeDefined();
  });

  it("JSON として読めない本文でも判定を付けない", () => {
    const result = toProbeResult("RJ01698658", "<html>error</html>");

    expect(result.delisted).toBeUndefined();
    expect(result.reason).toBeDefined();
  });
});
