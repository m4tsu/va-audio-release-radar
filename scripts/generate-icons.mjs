// scripts/generate-icons.mjs
//
// public/favicon.svg から、Web アプリマニフェストと iOS のホーム画面用の PNG を作る。
// あわせて、表紙画像を持たないページの og:image (public/og-image.png) を作る。
// PNG は生成物だが、ビルドのたびに作ると sharp のネイティブ依存を CI に要求するので、
// 作ったものを public/ にコミットする。favicon.svg を変えたらこれを流し直す。
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

// 大きさは `src/app/lib/site-image.ts` が og:image:width / height に出す値と揃える。
// 1200x630 は X と Facebook が大きい画像として扱う比率。
// 文字は英字だけにする。画像は日本語と英語のページで共有し、描画する環境に和文フォントがあるとは限らない
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const ICON_SIZE = 200;

const ogBackground = `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}">
  <rect width="100%" height="100%" fill="#111"/>
  <text x="${OG_WIDTH / 2}" y="440" text-anchor="middle" font-family="sans-serif" font-size="96" font-weight="700" fill="#fff">Koetrail</text>
  <text x="${OG_WIDTH / 2}" y="510" text-anchor="middle" font-family="sans-serif" font-size="34" fill="#fff" fill-opacity=".7">ASMR, audiobooks and audio dramas by voice actors</text>
</svg>`;
const ogIcon = await sharp(source, { density: 1024 }).resize(ICON_SIZE, ICON_SIZE).png().toBuffer();
const og = await sharp(Buffer.from(ogBackground))
  .composite([{ input: ogIcon, left: (OG_WIDTH - ICON_SIZE) / 2, top: 110 }])
  .png()
  .toBuffer();
writeFileSync(path.join(root, "public/og-image.png"), og);
console.log(`og-image.png (${OG_WIDTH}x${OG_HEIGHT})`);
