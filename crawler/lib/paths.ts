import path from "node:path";

/**
 * crawler が使うローカルパス。
 * 取得物はすべて `crawler/.cache/` の下に置き、リポジトリには入れない (.gitignore 済み)。
 * cwd ではなくこのファイルの位置を基準にするのは、どのディレクトリから実行しても
 * 同じ場所を読み書きさせるため
 */
export const CRAWLER_DIR = path.resolve(import.meta.dirname, "..");
export const CACHE_DIR = path.join(CRAWLER_DIR, ".cache");
/** 生の HTML / JSON の保存先 (企画書 §20 のデバッグ用) */
export const SNAPSHOT_DIR = path.join(CACHE_DIR, "snapshots");
/** `cli.ts diff` が前回結果を置く場所 */
export const LAST_RESULT_DIR = path.join(CACHE_DIR, "last");
export const FIXTURES_DIR = path.join(CRAWLER_DIR, "fixtures");

/** ファイル名に使えない文字を落とす。日本語はそのまま残す (人が見て分かるほうが調査しやすい) */
const UNSAFE_FILE_NAME_CHARS = /[^\p{Letter}\p{Number}._-]+/gu;
/** ファイル名の上限。ext4 の 255 バイト制限に対し、日本語 3 バイト/文字でも余裕を持たせる */
const MAX_FILE_NAME_LENGTH = 60;

export function safeFileName(value: string): string {
  const cleaned = value
    .normalize("NFC")
    .replace(UNSAFE_FILE_NAME_CHARS, "_")
    .replace(/^_+|_+$/g, "");
  // 空になると拡張子だけのファイル名になってしまうため、目印を入れる
  const fallback = cleaned === "" ? "unnamed" : cleaned;
  return fallback.slice(0, MAX_FILE_NAME_LENGTH);
}
