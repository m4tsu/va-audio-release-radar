import { Badge } from "@/app/components/ui/badge";
import { useLocale } from "@/app/i18n";
import { appearanceFormat, appearanceLabel } from "@/app/lib/appearance";

/**
 * 作品の出演形態。カードと作品ページの両方に出すのでここに置く。
 * 区分の決め方と境界の人数は `@/app/lib/appearance` が持つ。
 *
 * 形式のバッジと同じ無彩色で塗るのは、どちらも作品の属性という同じ層だから
 * (色が付くのはストアと新しさだけ)
 */
export function AppearanceBadge({ castSize }: { castSize: number }) {
  const locale = useLocale();
  return <Badge variant="secondary">{appearanceLabel(appearanceFormat(castSize), locale)}</Badge>;
}
