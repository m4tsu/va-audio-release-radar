import type { StoreSlug } from "../../src/domain/index.ts";

/**
 * ストアの表示名。標準出力とログにだけ出るもので、保存する値ではない。
 * 1 か所に置いてあるのは、走行ごとに別の名前で出ると同じストアだと読み取れないため
 */
export const STORE_LABELS: Record<StoreSlug, string> = {
  dlsite: "DLsite",
  audible: "Audible",
  pokedora: "ポケットドラマCD",
};

/** 集計表の見出し。列が狭いのでポケドラだけ短くする */
export const STORE_COLUMN_LABELS: Record<StoreSlug, string> = {
  ...STORE_LABELS,
  pokedora: "ポケドラ",
};
