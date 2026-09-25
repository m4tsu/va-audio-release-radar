import { z } from "zod";

/**
 * 複数のエンドポイントが同じ意味で受け取る値の検証。
 * 同じ値を別々の正規表現で見ると、片方の入口だけが通す値ができる
 */

/**
 * ストアから取った URL の検証。`https:` 以外は受け付けない。
 *
 * この値は `<a href>` と `<img src>` にそのまま出るので、`javascript:` や `data:` を
 * 通すとスクリプト実行の入口になる。平文の `http:` も混在コンテンツになるので弾く。
 * DLsite / Audible はどちらも https なので、これで実データを取りこぼすことはない
 */
export const httpsUrlSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith("https:"), { message: "https:// の URL のみ許可する" });

/** `YYYY-MM-DD` 固定。ストア側の表記ゆれをここで弾き、DB の並べ替えを文字列比較で成立させる */
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 形式で指定する");

/**
 * ISO 8601 の UTC 文字列 (`toISOString()` の形)。
 * 走行の時刻は管理画面の並びと集計が文字列比較で読むので、形が揃っていないと順序が壊れる
 */
export const isoDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, "ISO 8601 (UTC) で指定する")
  // 形だけでは "2026-13-45T99:99:99Z" が通る。日時として読めない値は集計で NaN になる
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: "日時として読めない" });
