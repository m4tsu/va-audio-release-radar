/**
 * ドメイン層の公開入口。
 *
 * 相対 import に `.ts` 拡張子を付けているのは、crawler (Node 24 の型剥がし実行) から
 * このファイルを直接 import できるようにするため。Node の ESM 解決は拡張子を補完しない。
 * tsconfig 側は `allowImportingTsExtensions` を有効にしてあるので、vite/tsc からも同じ表記で通る
 */
export * from "./actor-slug.ts";
export * from "./category.ts";
export * from "./identity.ts";
export * from "./normalize.ts";
export * from "./types.ts";
