import {
  type AppearanceFilter,
  DEFAULT_APPEARANCE_FILTER,
  isAppearanceFilter,
  matchesAppearance,
} from "@/app/lib/appearance";
import type { WorkWithListings } from "@/app/lib/view-types";
import { STORE_SLUGS, type StoreSlug, WORK_CATEGORIES, type WorkCategory } from "@/domain/types";

/**
 * 声優ページの作品一覧の絞り込み。軸は ストア / 区分 / 出演形態 の 3 つで、
 * どれも「絞っていない」を表す `all` を持つ。
 *
 * 選択肢は声優ごとに変えず、どの声優のページでも同じ並びで同じ数だけ出す。
 * 手元にある作品から選択肢を作ると、一覧を上限で切った先にしか無いストアや区分が
 * 選べなくなり、同じ軸が声優によって現れたり消えたりする。
 * 0 件になる値を選べることは、その条件の作品が無いという答えとして画面に出す
 */

export const STORE_FILTERS = ["all", ...STORE_SLUGS] as const;
export type StoreFilter = (typeof STORE_FILTERS)[number];

export const CATEGORY_FILTERS = ["all", ...WORK_CATEGORIES] as const;
export type CategoryFilter = (typeof CATEGORY_FILTERS)[number];

export type WorkFilters = {
  store: StoreFilter;
  category: CategoryFilter;
  appearance: AppearanceFilter;
};

export const DEFAULT_WORK_FILTERS: WorkFilters = {
  store: "all",
  category: "all",
  appearance: DEFAULT_APPEARANCE_FILTER,
};

/** URL から来た値を受けるので、文字列でないものも弾けるようにしてある */
export function isStoreFilter(value: unknown): value is StoreFilter {
  return typeof value === "string" && (STORE_FILTERS as readonly string[]).includes(value);
}

export function isCategoryFilter(value: unknown): value is CategoryFilter {
  return typeof value === "string" && (CATEGORY_FILTERS as readonly string[]).includes(value);
}

/**
 * URL の検索文字列を絞り込みに直す。読めない値は「絞っていない」として扱う。
 * 共有された URL の欄が 1 つ壊れているだけで 0 件の画面になると、リンクが壊れて見える
 */
export function readWorkFilters(search: {
  store?: unknown;
  category?: unknown;
  appearance?: unknown;
}): WorkFilters {
  return {
    store: isStoreFilter(search.store) ? search.store : DEFAULT_WORK_FILTERS.store,
    category: isCategoryFilter(search.category) ? search.category : DEFAULT_WORK_FILTERS.category,
    appearance: isAppearanceFilter(search.appearance)
      ? search.appearance
      : DEFAULT_WORK_FILTERS.appearance,
  };
}

/**
 * URL に載せる欄。既定値の軸は欄ごと落とす。
 *
 * 載せると、ルーターがハイドレーション時に素の URL を `?store=all` に書き換え、
 * head() が出す canonical (欄なし) と食い違う
 */
export function workFilterSearch(filters: WorkFilters): {
  store?: StoreSlug;
  category?: WorkCategory;
  appearance?: AppearanceFilter;
} {
  return {
    ...(filters.store === "all" ? {} : { store: filters.store }),
    ...(filters.category === "all" ? {} : { category: filters.category }),
    ...(filters.appearance === DEFAULT_APPEARANCE_FILTER ? {} : { appearance: filters.appearance }),
  };
}

/** 3 つの軸すべてに残る作品。ストアは掲載のどれかが一致すればよい */
export function filterWorks(
  works: readonly WorkWithListings[],
  filters: WorkFilters,
): WorkWithListings[] {
  return works.filter(
    (item) =>
      matchesStore(item, filters.store) &&
      (filters.category === "all" || item.work.category === filters.category) &&
      matchesAppearance(filters.appearance, item.castSize),
  );
}

function matchesStore(item: WorkWithListings, store: StoreFilter): boolean {
  return store === "all" || item.listings.some((listing) => listing.storeSlug === store);
}
