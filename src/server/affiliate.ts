import type { StoreSlug } from "@/domain/types";
import type { WorkListing } from "./queries/works";

/**
 * ストアへのリンクをアフィリエイト URL にする規則。ストアを足すときはここの `RULES` だけを触る。
 *
 * `store_listings.affiliate_url` 列は使わず、表示のたびに listing とアフィリエイト ID から組み立てる。
 * ID を変えても再クロールせずに全作品のリンクが切り替わるようにするため。
 *
 * アフィリエイト ID は URL に出る公開値なので、秘匿値ではなく wrangler.jsonc の `vars` に置く。
 * ID が 1 つでも空のストアと、組み立て方の無いストアは組み立てず、画面は正規 URL を出す。
 * 組み立てた URL が `https:` でなければ画面が正規 URL に落とす (`@/app/components/store-link`)
 */

type AffiliateTarget = Pick<
  WorkListing,
  "storeSlug" | "storeProductId" | "storeSection" | "productUrl"
>;

type AffiliateLink = {
  url: string;
  /** 広告コードに含まれる成果計測の画像。消すと広告コードの改変になるので、リンクと一緒に出す */
  beaconUrl?: string;
};

type Rule = {
  envKeys: readonly string[];
  /**
   * `ids` は `envKeys` と同じ順の値で、どれも空でない。
   * 無いストアと、undefined を返した作品は ID が入っていても正規 URL のまま出す
   */
  build?: (ids: string[], listing: AffiliateTarget) => AffiliateLink | undefined;
};

/**
 * DLsite のアフィリエイト URL の先頭のパスは、作品が所属するフロア。`store_section` (product.json の
 * `site_id`) から引く。`product_url` は検索したフロアで作られ、所属と食い違うので使わない。
 * 出どころは docs/stores/dlsite.md の「アフィリエイトリンク」
 */
const DLSITE_AFFILIATE_FLOORS: ReadonlyMap<string, string> = new Map([
  ["home", "home"],
  ["girls", "girls"],
  ["bl", "bl"],
  ["pro", "pro"],
  ["soft", "soft"],
  // `/garumani/` の作品は所属をフロア名ではなく作品の区分で返す
  ["bldrama", "garumani"],
  ["girlsdrama", "garumani"],
]);

const RULES = {
  dlsite: {
    envKeys: ["DLSITE_AFFILIATE_ID"],
    // 所属が分からない作品は、誤ったフロアのリンクで成果を落とすより正規 URL に残す。
    // `t/n` の意味は確かめておらず、管理画面の出力をそのまま写している
    build: ([affiliateId = ""], { storeProductId, storeSection }) => {
      const floor = storeSection ? DLSITE_AFFILIATE_FLOORS.get(storeSection) : undefined;
      if (!floor) return undefined;
      return {
        url: `https://dlaf.jp/${floor}/dlaf/=/t/n/link/work/aid/${encodeURIComponent(affiliateId)}/id/${encodeURIComponent(storeProductId)}.html`,
      };
    },
  },
  audible: { envKeys: ["AUDIBLE_AFFILIATE_ID"] },
  // バリューコマースの MyLink。出どころは docs/stores/pokedora.md の「アフィリエイトリンク」
  pokedora: {
    envKeys: ["POKEDORA_VC_SID", "POKEDORA_VC_PID"],
    build: ([sid = "", pid = ""], { productUrl }) => {
      // 管理画面は作品ページの URL をそのまま `vc_url` に入れる。https でない URL へは送らない
      if (!isHttpsUrl(productUrl)) return undefined;
      const account = `sid=${encodeURIComponent(sid)}&pid=${encodeURIComponent(pid)}`;
      // 管理画面の出力はプロトコル相対。画面は https の URL しか出さないので https を明示する
      return {
        url: `https://ck.jp.ap.valuecommerce.com/servlet/referral?${account}&vc_url=${encodeURIComponent(productUrl)}`,
        beaconUrl: `https://ad.jp.ap.valuecommerce.com/servlet/gifbanner?${account}`,
      };
    },
  },
} as const satisfies Record<StoreSlug, Rule>;

/** `vars` のうちアフィリエイト ID を持つもの。空文字は未設定として扱う */
export type AffiliateEnv = {
  [K in (typeof RULES)[StoreSlug]["envKeys"][number]]?: string;
};

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** ID が 1 つでも空か、組み立て方が無いストアは undefined */
export function affiliateLinkFor(
  listing: AffiliateTarget,
  env: AffiliateEnv,
): AffiliateLink | undefined {
  const rule: Rule = RULES[listing.storeSlug];
  if (!rule.build) return undefined;
  const ids = rule.envKeys.map((key) => env[key as keyof AffiliateEnv]?.trim() ?? "");
  if (ids.some((id) => !id)) return undefined;
  return rule.build(ids, listing);
}

/** 作品ページと一覧が同じ URL を出すよう、listing を返す server function はすべてこれを通す */
export function withAffiliateUrls<T extends { listings: WorkListing[] }>(
  item: T,
  env: AffiliateEnv,
): T {
  return {
    ...item,
    listings: item.listings.map((listing) => {
      const link = affiliateLinkFor(listing, env);
      if (!link) return listing;
      return {
        ...listing,
        affiliateUrl: link.url,
        ...(link.beaconUrl ? { affiliateBeaconUrl: link.beaconUrl } : {}),
      };
    }),
  };
}
