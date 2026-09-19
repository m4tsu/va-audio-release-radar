import { Badge } from "@/app/components/ui/badge";
import { cn } from "@/app/lib/utils";
import type { StoreSlug } from "@/domain/types";

/** ストアの表示名。slug ("dlsite") をそのまま画面に出さないための 1 箇所 */
export const STORE_LABELS: Record<StoreSlug, string> = {
  dlsite: "DLsite",
  audible: "Audible",
  // 正式名称は「ポケットドラマCD」。バッジに入る長さで、通称として定着している短縮形を使う
  pokedora: "ポケドラ",
};

export function storeLabel(store: StoreSlug): string {
  return STORE_LABELS[store];
}

export function StoreBadge({ store, className }: { store: StoreSlug; className?: string }) {
  return (
    <Badge variant="outline" className={cn("font-mono text-[0.7rem]", className)}>
      {STORE_LABELS[store]}
    </Badge>
  );
}
