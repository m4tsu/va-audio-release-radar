import { describe, expect, it } from "vitest";
import { affiliateUrlFor, withAffiliateUrls } from "./affiliate";
import type { WorkListing } from "./queries/works";

const ALL_IDS = {
  DLSITE_AFFILIATE_ID: "do65m205lfao7",
  AUDIBLE_AFFILIATE_ID: "audible-id",
  POKEDORA_AFFILIATE_ID: "pokedora-id",
};

function listing(over: Partial<WorkListing> = {}): WorkListing {
  return {
    storeSlug: "dlsite",
    storeProductId: "RJ01000419",
    productUrl: "https://www.dlsite.com/home/work/=/product_id/RJ01000419.html",
    titleRaw: "架空のASMR作品",
    firstSeenAt: "2026-09-18T00:00:00.000Z",
    lastSeenAt: "2026-09-18T00:00:00.000Z",
    ...over,
  };
}

describe("affiliateUrlFor", () => {
  it("DLsite は RJ 番号とアフィリエイト ID だけから dlaf.jp の URL を組み立てる", () => {
    expect(affiliateUrlFor("dlsite", "RJ01000419", ALL_IDS)).toBe(
      "https://dlaf.jp/home/dlaf/=/t/n/link/work/aid/do65m205lfao7/id/RJ01000419.html",
    );
  });

  it("ID が空か空白だけなら組み立てない", () => {
    expect(affiliateUrlFor("dlsite", "RJ01000419", {})).toBeUndefined();
    expect(affiliateUrlFor("dlsite", "RJ01000419", { DLSITE_AFFILIATE_ID: " " })).toBeUndefined();
  });

  it("組み立て方の無いストアは ID が入っていても組み立てない", () => {
    expect(affiliateUrlFor("audible", "B0ABC", ALL_IDS)).toBeUndefined();
    expect(affiliateUrlFor("pokedora", "123", ALL_IDS)).toBeUndefined();
  });

  /** 商品 ID は外部由来の文字列。区切り文字が混ざってもパスの別の位置に効かないようにする */
  it("ID と商品 ID をパスの 1 区間に閉じ込める", () => {
    expect(affiliateUrlFor("dlsite", "RJ1/../x", ALL_IDS)).toBe(
      "https://dlaf.jp/home/dlaf/=/t/n/link/work/aid/do65m205lfao7/id/RJ1%2F..%2Fx.html",
    );
  });
});

describe("withAffiliateUrls", () => {
  it("listing ごとに組み立てた URL を付け、組み立てられないストアには付けない", () => {
    const item = withAffiliateUrls(
      {
        listings: [
          listing(),
          listing({ storeSlug: "audible", storeProductId: "B0ABC", productUrl: "https://a" }),
        ],
      },
      ALL_IDS,
    );

    expect(item.listings[0]?.affiliateUrl).toBe(
      "https://dlaf.jp/home/dlaf/=/t/n/link/work/aid/do65m205lfao7/id/RJ01000419.html",
    );
    expect(item.listings[1]).not.toHaveProperty("affiliateUrl");
  });
});
