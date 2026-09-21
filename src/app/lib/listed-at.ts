import type { WorkWithListings } from "@/app/lib/view-types";

/**
 * 発売日を持たない作品の時点。
 *
 * ポケットドラマ CD は商品ページに発売日が無く (`docs/stores/pokedora.md`)、Audible の
 * ポッドキャストにも無い。発売日が空の作品を日付の行ごと落とすと、その作品は
 * いつごろのものかがどこにも出ない。代わりに出すのは「こちらが掲載を見つけた日」で、
 * 発売日ではない。画面はこれを発売日と別の見出しで出す
 */

/** その作品をどのストアであれ最初に見つけた日時 (ISO 8601)。未読の判定にも使う */
export function earliestFirstSeen(listings: WorkWithListings["listings"]): string | undefined {
  let earliest: string | undefined;
  for (const listing of listings) {
    if (earliest === undefined || listing.firstSeenAt < earliest) earliest = listing.firstSeenAt;
  }
  return earliest;
}

/**
 * 掲載を確認した日 ("YYYY-MM-DD")。発売日を持つ作品と、掲載が 1 件も無い作品は undefined。
 *
 * 画面が出すのは月まで。日まで出すと発売日と同じ精度に見えるが、これはクロールを回した日で
 * あって作品の側の日付ではない
 */
export function listedAt(item: Pick<WorkWithListings, "work" | "listings">): string | undefined {
  if (item.work.releaseDate) return undefined;
  return earliestFirstSeen(item.listings)?.slice(0, 10);
}
