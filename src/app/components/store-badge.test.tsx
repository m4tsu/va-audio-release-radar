import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { STORE_TONES } from "@/app/components/store-badge";
import { STORE_SLUGS } from "@/domain/types";

const css = readFileSync(path.resolve(import.meta.dirname, "../../index.css"), "utf8");

/** ライトとダークで色は別に定義されているので、選択子ごとに中身を取り出して比べる */
function storeColorsIn(selector: string): string[] {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf("\n}", start));
  return STORE_SLUGS.map((store) => {
    const color = body.match(new RegExp(`--store-${store}:([^;]+);`))?.[1];
    if (color === undefined) throw new Error(`${selector} に --store-${store} が無い`);
    return color.trim();
  });
}

/**
 * 「ストアごとに違う色」を守れる場所は 2 つある。`src/index.css` のトークンの値と、
 * バッジのクラスがどのトークンを指すか。どちらも描画結果からは読めない
 * (jsdom は CSS を解決せず、計算値もトークン名のまま返る) ので、定義そのものを読む
 */
describe("ストアのバッジの色", () => {
  test.each([":root", ".dark"])("%s でストアごとに違う色を定義している", (selector) => {
    const colors = storeColorsIn(selector);

    expect(new Set(colors).size).toBe(STORE_SLUGS.length);
  });

  test("バッジのクラスは自分のストアのトークンだけを指す", () => {
    for (const store of STORE_SLUGS) {
      const referenced = STORE_TONES[store].match(/store-[a-z]+/g) ?? [];

      expect(new Set(referenced)).toEqual(new Set([`store-${store}`]));
    }
  });
});
