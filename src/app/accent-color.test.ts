import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * アクセントカラー (`--primary`) の値を `src/index.css` から読んで確かめる。
 * 色はトークンにしか無く、jsdom はスタイルシートを計算しないので、画面の描画からは検査できない
 */

const CSS = readFileSync(path.resolve(import.meta.dirname, "../index.css"), "utf8");

type Oklch = { l: number; c: number; h: number };

function block(selector: ":root" | ".dark"): string {
  const start = CSS.indexOf(`\n${selector} {`);
  if (start < 0) throw new Error(`${selector} が index.css に無い`);
  return CSS.slice(start, CSS.indexOf("\n}", start));
}

function token(selector: ":root" | ".dark", name: string): Oklch {
  const match = block(selector).match(
    new RegExp(`--${name}:\\s*oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`),
  );
  if (!match) throw new Error(`${selector} に --${name} の不透明な oklch が無い`);
  return { l: Number(match[1]), c: Number(match[2]), h: Number(match[3]) };
}

/** OKLCH → 線形 sRGB の相対輝度 (WCAG の定義) */
function luminance({ l, c, h }: Oklch): number {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  const r = clamp(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_);
  const g = clamp(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_);
  const bl = clamp(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_);
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

function contrast(x: Oklch, y: Oklch): number {
  const [lx, ly] = [luminance(x), luminance(y)];
  return (Math.max(lx, ly) + 0.05) / (Math.min(lx, ly) + 0.05);
}

function hueDistance(x: number, y: number): number {
  const d = Math.abs(x - y) % 360;
  return Math.min(d, 360 - d);
}

describe.each([":root", ".dark"] as const)("アクセントカラー (%s)", (selector) => {
  const primary = token(selector, "primary");

  test("地の上の文字が WCAG AA (4.5:1) 以上で読める", () => {
    expect(contrast(primary, token(selector, "primary-foreground"))).toBeGreaterThanOrEqual(4.5);
  });

  /** 主ボタンの輪郭はページの地の上にアクセントカラーで描く。非テキストの対比 3:1 */
  test("フォーカスの輪郭がページの地の上で見える", () => {
    expect(contrast(primary, token(selector, "background"))).toBeGreaterThanOrEqual(3);
  });

  test.each(["store-dlsite", "store-audible", "store-pokedora"])(
    "色相が %s から 40 度以上離れている",
    (store) => {
      expect(hueDistance(primary.h, token(selector, store).h)).toBeGreaterThanOrEqual(40);
    },
  );

  test("無彩色ではない", () => {
    expect(primary.c).toBeGreaterThan(0.05);
  });
});
