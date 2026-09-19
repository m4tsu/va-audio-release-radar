// scripts/check-name-variant-collisions.mjs
//
// なぜ: `normalizeName` に人名の異体字の畳み込みを入れると (T21 / decisions.md §16)、
// 名寄せと検索の鍵が粗くなる。粗くすれば取りこぼしは減るが、**別人が同じ鍵になる**危険が増える。
// 「増えたのは一致だけで、衝突は増えていない」を実データで確かめないと入れられないので、
// ローカル D1 の声優 2,569 人を全部通して衝突を数える。
//
// 読み取り専用で開く。書き込みは一切しない。
//
//   node scripts/check-name-variant-collisions.mjs

import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { nameVariantPairs, normalizeName } from "../src/domain/normalize.ts";

const D1_STATE_DIR = path.join(".wrangler", "state", "v3", "d1", "miniflare-D1DatabaseObject");

/**
 * 異体字を畳む前の `normalizeName` (T21 以前の実装をそのまま写したもの)。
 *
 * 現行の実装から畳み込みだけを外す手段が無いので、比較対象をここに固定する。
 * これは「変更前はこうだった」という基準線であり、本番の名寄せには使われない
 */
const SYMBOLS_TO_STRIP = /[\s・「」【】()（）,、.。/／\-‐ー?!]/g;
function normalizeNameBefore(name) {
  return name.normalize("NFKC").replace(SYMBOLS_TO_STRIP, "").toLowerCase();
}

function findD1SqliteFile(d1StateDir) {
  if (!existsSync(d1StateDir)) return null;
  const candidates = readdirSync(d1StateDir)
    .filter((name) => path.extname(name) === ".sqlite" && name !== "metadata.sqlite")
    .map((name) => path.join(d1StateDir, name));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return candidates[0];
}

/**
 * 畳んだせいで**新しく**生まれた衝突だけを返す。
 *
 * 判定は「値が違う 2 件が、畳む前は別の鍵だったのに、畳んだ後で同じ鍵になったか」。
 * 畳む前から同じ鍵だった組 (同姓同名、空白違いの同名など) は異体字とは無関係なので除く
 */
function newCollisions(items, keyBefore, keyAfter, valueOf) {
  const buckets = new Map();
  for (const item of items) {
    const key = keyAfter(item);
    const bucket = buckets.get(key) ?? [];
    bucket.push({ before: keyBefore(item), value: valueOf(item) });
    buckets.set(key, bucket);
  }

  const found = [];
  for (const [key, bucket] of buckets) {
    const values = new Set(bucket.map((entry) => entry.value));
    if (values.size < 2) continue;
    const merged = bucket.some((a) =>
      bucket.some((b) => a.value !== b.value && a.before !== b.before),
    );
    if (merged) found.push({ key, values: [...values].sort() });
  }
  return found;
}

export function inspect(rows) {
  const actors = rows.actors;
  const names = rows.names;

  return {
    actorCount: actors.length,
    nameCount: names.length,
    // 1. 正規化後の canonical_name が衝突する組
    canonicalCollisions: newCollisions(
      actors,
      (actor) => normalizeNameBefore(actor.canonical_name),
      (actor) => normalizeName(actor.canonical_name),
      (actor) => actor.canonical_name,
    ),
    // 2. canonical_name と alias を合わせた名寄せ索引で、別人が同じ鍵になる組。
    //    resolveCredit はこうなった表記を ambiguous として unmatched に落とすので、
    //    衝突は「誤マッチ」ではなく「今まで解決できていた表記が解決できなくなる」形で効く
    indexCollisions: newCollisions(
      names,
      (row) => normalizeNameBefore(row.name),
      (row) => normalizeName(row.name),
      (row) => row.voice_actor_id,
    ),
  };
}

function readRows(sqliteFile) {
  const db = new DatabaseSync(sqliteFile, { readOnly: true });
  try {
    const actors = db.prepare("SELECT id, canonical_name FROM voice_actors").all();
    const aliases = db.prepare("SELECT voice_actor_id, name FROM voice_actor_aliases").all();
    const names = [
      ...actors.map((actor) => ({ voice_actor_id: actor.id, name: actor.canonical_name })),
      ...aliases,
    ];
    return { actors, names };
  } finally {
    db.close();
  }
}

function main() {
  const sqliteFile = findD1SqliteFile(path.join(process.cwd(), D1_STATE_DIR));
  if (!sqliteFile) {
    console.error("ローカル D1 が見つかりません");
    return 1;
  }
  const result = inspect(readRows(sqliteFile));

  console.log(`声優 ${result.actorCount} 人 / 名前 (canonical + alias) ${result.nameCount} 件`);
  console.log(`畳んでいる異体字: ${nameVariantPairs().length} 組`);
  console.log(
    nameVariantPairs()
      .map(([variant, base]) => `  ${variant} (U+${variant.codePointAt(0).toString(16).toUpperCase()}) → ${base}`)
      .join("\n"),
  );

  console.log(`\ncanonical_name の新規衝突: ${result.canonicalCollisions.length} 組`);
  for (const collision of result.canonicalCollisions) {
    console.log(`  ${collision.key}: ${collision.values.join(" / ")}`);
  }

  console.log(`名寄せ索引の新規衝突 (別人が同じ鍵): ${result.indexCollisions.length} 組`);
  for (const collision of result.indexCollisions) {
    console.log(`  ${collision.key}: ${collision.values.join(" / ")}`);
  }

  const total = result.canonicalCollisions.length + result.indexCollisions.length;
  console.log(total === 0 ? "\n衝突なし" : "\n衝突あり。変換表を見直すこと");
  return total === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
