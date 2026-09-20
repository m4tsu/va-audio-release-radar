import { EmptyState } from "@/app/components/empty-state";
import { useT } from "@/app/i18n";

/**
 * アニメ導線の入口。データのある最新シーズンへ送るのはルート側の loader で、
 * ここが描かれるのは送り先が無いとき (アニメが 1 本も入っていないとき) だけ
 */
export function AnimeIndexPage() {
  const t = useT();
  return <EmptyState title={t("anime.indexEmptyTitle")} />;
}
