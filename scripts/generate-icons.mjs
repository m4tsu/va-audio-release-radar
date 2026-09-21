// scripts/generate-icons.mjs
//
// public/favicon.svg から、Web アプリマニフェストと iOS のホーム画面用の PNG を作る。
// PNG は生成物だが、ビルドのたびに作ると sharp のネイティブ依存を CI に要求するので、
// 作ったものを public/icons/ にコミットする。favicon.svg を変えたらこれを流し直す。
//
// sharp は依存の依存として node_modules にある。直接の依存に足していないので、
// 消えていたら `npx sharp-cli` などに置き換える

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const source = readFileSync(path.join(root, "public/favicon.svg"));
const outDir = path.join(root, "public/icons");
mkdirSync(outDir, { recursive: true });

/** 名前と一辺の長さ。マニフェスト (`src/app/lib/manifest.ts`) と __root.tsx が参照する名前 */
const targets = [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  // iOS はマニフェストの icons を見ず、<link rel="apple-touch-icon"> の 180px を使う
  ["apple-touch-icon.png", 180],
];

for (const [name, size] of targets) {
  const png = await sharp(source, { density: 384 }).resize(size, size).png().toBuffer();
  writeFileSync(path.join(outDir, name), png);
  console.log(`${name} (${size}px)`);
}
