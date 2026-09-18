import type { BatchItem } from "drizzle-orm/batch";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type * as schema from "./schema";

/**
 * クエリ関数が受け取る DB ハンドルの型。
 *
 * 本番は D1 (`drizzle-orm/d1`)、単体テストはインメモリ SQLite (`drizzle-orm/libsql`) と
 * ドライバが異なるが、どちらも `BaseSQLiteDatabase<"async", ...>` の派生なのでここで束ねる。
 * 実行結果の型 (TRunResult) はドライバごとに違い、クエリ側では使わないので `unknown` にする。
 *
 * `batch` は `BaseSQLiteDatabase` には無いが D1 と libsql の両方が同じ形で持っているので、
 * ここで最小限の宣言だけ足している。戻り値はドライバごとに違うため `unknown[]` に潰す
 * (ingest は「まとめて投げる」ためだけに使い、結果は見ない)。
 * `db.transaction` は D1 に対話的トランザクションが無いので使えないままにしてある
 */
export type AppDb = BaseSQLiteDatabase<"async", unknown, typeof schema> & {
  batch(statements: BatchStatements): Promise<unknown>;
};

/** `db.batch` に渡せる文の並び。D1 も libsql も「1 件以上」を要求する */
export type BatchStatements = readonly [BatchItem<"sqlite">, ...Array<BatchItem<"sqlite">>];
