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

/**
 * ストアごとの色。並んだバッジのどれが「どこで買えるか」なのかを、形式や出演形態 (無彩色) と
 * 分けて読めるようにする。ストア同士も色相を分け、同じストアはどの画面でも同じ色になる。
 * 色の値は `src/index.css` のトークンが持ち、ライトとダークで明度が入れ替わる
 */
const STORE_TONES: Record<StoreSlug, string> = {
  dlsite: "border-store-dlsite/40 bg-store-dlsite/10 text-store-dlsite",
  audible: "border-store-audible/40 bg-store-audible/10 text-store-audible",
  pokedora: "border-store-pokedora/40 bg-store-pokedora/10 text-store-pokedora",
};

export function storeLabel(store: StoreSlug): string {
  return STORE_LABELS[store];
}

export function StoreBadge({ store, className }: { store: StoreSlug; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("font-mono text-[0.7rem]", STORE_TONES[store], className)}
    >
      {STORE_LABELS[store]}
    </Badge>
  );
}
