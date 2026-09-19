import { ExternalLink } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { type TKey, useT } from "@/app/i18n";
import { safeHttpsUrl } from "@/app/lib/safe-url";
import type { WorkListing } from "@/app/lib/view-types";
import type { StoreSlug } from "@/domain/types";

/** ストアごとの導線の文言。買う場所に合わせて「見る」「聴く」を変える */
const CALL_TO_ACTION = {
  dlsite: "storeLink.dlsite",
  audible: "storeLink.audible",
  pokedora: "storeLink.pokedora",
} as const satisfies Record<StoreSlug, TKey>;

/**
 * ストアへの外部リンク。
 *
 * - アフィリエイト URL があればそちらへ送る。無ければ正規 URL
 * - `rel` に `sponsored` を付けるのは報酬が発生しうるリンクだから。`nofollow` で
 *   評価を渡さず、`noopener` で遷移先から元タブを触れないようにする
 * - URL は https のものしか出さない。`javascript:` などがそのまま href に出ると、
 *   ストアのページを踏んだつもりのクリックがスクリプト実行になる
 */
export function StoreLink({ listing, className }: { listing: WorkListing; className?: string }) {
  const t = useT();
  const href = safeHttpsUrl(listing.affiliateUrl) ?? safeHttpsUrl(listing.productUrl);
  if (!href) {
    // リンク先が無いので押せるものは出さない。価格などの情報は呼び出し側が既に出している
    return <p className="text-muted-foreground text-sm">{t("storeLink.missing")}</p>;
  }

  return (
    <Button asChild className={className}>
      <a href={href} target="_blank" rel="noopener nofollow sponsored">
        {t(CALL_TO_ACTION[listing.storeSlug])}
        <ExternalLink aria-hidden="true" />
      </a>
    </Button>
  );
}
