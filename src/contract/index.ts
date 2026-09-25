/**
 * 境界を越える形 (wire format) の公開入口。crawler ↔ Worker と ブラウザ ↔ Worker の両側が読む。
 *
 * 相対 import に `.ts` 拡張子を付けているのは、crawler (Node 24 の型剥がし実行) から
 * このファイルを直接 import できるようにするため (`src/domain/index.ts` と同じ理由)
 */
export * from "./admin-api.ts";
export * from "./ingest.ts";
export * from "./public-api.ts";
