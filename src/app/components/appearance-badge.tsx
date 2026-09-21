import { Badge } from "@/app/components/ui/badge";
import { useLocale } from "@/app/i18n";
import { appearanceFormat, appearanceLabel } from "@/app/lib/appearance";

/**
 * 作品の出演形態。カードと作品ページの両方に出すのでここに置く。
 * 区分の決め方と境界の人数は `@/app/lib/appearance` が持つ
 */
export function AppearanceBadge({ castSize }: { castSize: number }) {
  const locale = useLocale();
  return <Badge variant="outline">{appearanceLabel(appearanceFormat(castSize), locale)}</Badge>;
}
