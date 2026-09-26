import { Badge } from "@/app/components/ui/badge";
import { useT } from "@/app/i18n";

/**
 * アフィリエイトリンクの広告表記。リンクより前に置き、押す前に目に入るようにする。
 * 付ける理由と付けるリンクの範囲は `docs/decisions/0019-operator-and-pr-label.md`
 */
export function PrLabel() {
  const t = useT();
  return <Badge variant="outline">{t("storeLink.pr")}</Badge>;
}
