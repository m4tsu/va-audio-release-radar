import type { StoreSlug } from "@/domain/types";
import type { WorkListing } from "./queries/works";

/**
 * ストアへのリンクをアフィリエイト URL にする規則。ストアを足すときはここの `RULES` だけを触る。
 *
 * `store_listings.affiliate_url` 列は使わず、表示のたびに listing とアフィリエイト ID から組み立てる。
 * ID を変えても再クロールせずに全作品のリンクが切り替わるようにするため。
 *
 * アフィリエイト ID は URL に出る公開値なので、秘匿値ではなく wrangler.jsonc の `vars` に置く。
 * ID が空か組み立て方の無いストアは組み立てず、画面は正規 URL を出す。
 * 組み立てた URL が `https:` でなければ画面が正規 URL に落とす (`@/app/components/store-link`)
 */

type AffiliateTarget = Pick<WorkListing, "storeSlug" | "storeProductId" | "storeSection">;

type Rule = {
  envKey: string;
  /** 無いストアと、undefined を返した作品は ID が入っていても正規 URL のまま出す */
  build?: (affiliateId: string, listing: AffiliateTarget) => string | undefined;
};

/**
 * DLsite のアフィリエイト URL の先頭のパスは、作品が所属するフロア。`store_section` (product.json の
 * `site_id`) から引く。`product_url` は検索したフロアで作られ、所属と食い違うので使わない。
 * 出どころは docs/stores/dlsite.md の「アフィリエイトリンク」
 */
const DLSITE_AFFILIATE_FLOORS: Readonly<Record<string, string>> = {
  home: "home",
  girls: "girls",
  bl: "bl",
  pro: "pro",
  soft: "soft",
  // `/garumani/` の作品は所属をフロア名ではなく作品の区分で返す
  bldrama: "garumani",
  girlsdrama: "garumani",
};

const RULES = {
  dlsite: {
    envKey: "DLSITE_AFFILIATE_ID",
    // 所属が分からない作品は、誤ったフロアのリンクで成果を落とすより正規 URL に残す。
    // `t/n` の意味は確かめておらず、管理画面の出力をそのまま写している
    build: (affiliateId, { storeProductId, storeSection }) => {
      const floor = storeSection ? DLSITE_AFFILIATE_FLOORS[storeSection] : undefined;
      if (!floor) return undefined;
      return `https://dlaf.jp/${floor}/dlaf/=/t/n/link/work/aid/${encodeURIComponent(affiliateId)}/id/${encodeURIComponent(storeProductId)}.html`;
    },
  },
  audible: { envKey: "AUDIBLE_AFFILIATE_ID" },
  pokedora: { envKey: "POKEDORA_AFFILIATE_ID" },
} as const satisfies Record<StoreSlug, Rule>;

/** `vars` のうちアフィリエイト ID を持つもの。空文字は未設定として扱う */
export type AffiliateEnv = { [K in (typeof RULES)[StoreSlug]["envKey"]]?: string };

/** ID が空か組み立て方が無いストアは undefined */
export function affiliateUrlFor(listing: AffiliateTarget, env: AffiliateEnv): string | undefined {
  const rule: { envKey: keyof AffiliateEnv } & Rule = RULES[listing.storeSlug];
  const affiliateId = env[rule.envKey]?.trim();
  if (!affiliateId || !rule.build) return undefined;
  return rule.build(affiliateId, listing);
}

/** 作品ページと一覧が同じ URL を出すよう、listing を返す server function はすべてこれを通す */
export function withAffiliateUrls<T extends { listings: WorkListing[] }>(
  item: T,
  env: AffiliateEnv,
): T {
  return {
    ...item,
    listings: item.listings.map((listing) => {
      const affiliateUrl = affiliateUrlFor(listing, env);
      return affiliateUrl ? { ...listing, affiliateUrl } : listing;
    }),
  };
}
