import type { StoreSlug } from "@/domain/types";
import type { WorkListing } from "./queries/works";

/**
 * ストアへのリンクをアフィリエイト URL にする規則。ストアを足すときはここの `RULES` だけを触る。
 *
 * `store_listings.affiliate_url` 列は使わず、表示のたびに商品 ID とアフィリエイト ID から組み立てる。
 * ID を変えても再クロールせずに全作品のリンクが切り替わるようにするため。
 *
 * アフィリエイト ID は URL に出る公開値なので、秘匿値ではなく wrangler.jsonc の `vars` に置く。
 * ID が空か組み立て方の無いストアは組み立てず、画面は正規 URL を出す。
 * 組み立てた URL が `https:` でなければ画面が正規 URL に落とす (`@/app/components/store-link`)
 */

type Rule = {
  envKey: string;
  /** 無いストアと、undefined を返した作品は ID が入っていても正規 URL のまま出す */
  build?: (affiliateId: string, storeProductId: string) => string | undefined;
};

const RULES = {
  // 出どころは docs/stores/dlsite.md の「アフィリエイトリンク」
  dlsite: {
    envKey: "DLSITE_AFFILIATE_ID",
    // 形を確かめたのは `RJ` の作品だけ。`/garumani/` から来る `BJ` の作品に `home` のパスが
    // 通じるかは分からないので、正規 URL に残す。`t/n` の意味も確かめておらず、管理画面の出力をそのまま写している
    build: (affiliateId, storeProductId) =>
      storeProductId.startsWith("RJ")
        ? `https://dlaf.jp/home/dlaf/=/t/n/link/work/aid/${encodeURIComponent(affiliateId)}/id/${encodeURIComponent(storeProductId)}.html`
        : undefined,
  },
  audible: { envKey: "AUDIBLE_AFFILIATE_ID" },
  pokedora: { envKey: "POKEDORA_AFFILIATE_ID" },
} as const satisfies Record<StoreSlug, Rule>;

/** `vars` のうちアフィリエイト ID を持つもの。空文字は未設定として扱う */
export type AffiliateEnv = { [K in (typeof RULES)[StoreSlug]["envKey"]]?: string };

/** ID が空か組み立て方が無いストアは undefined */
export function affiliateUrlFor(
  storeSlug: StoreSlug,
  storeProductId: string,
  env: AffiliateEnv,
): string | undefined {
  const rule: { envKey: keyof AffiliateEnv } & Rule = RULES[storeSlug];
  const affiliateId = env[rule.envKey]?.trim();
  if (!affiliateId || !rule.build) return undefined;
  return rule.build(affiliateId, storeProductId);
}

/** 作品ページと一覧が同じ URL を出すよう、listing を返す server function はすべてこれを通す */
export function withAffiliateUrls<T extends { listings: WorkListing[] }>(
  item: T,
  env: AffiliateEnv,
): T {
  return {
    ...item,
    listings: item.listings.map((listing) => {
      const affiliateUrl = affiliateUrlFor(listing.storeSlug, listing.storeProductId, env);
      return affiliateUrl ? { ...listing, affiliateUrl } : listing;
    }),
  };
}
