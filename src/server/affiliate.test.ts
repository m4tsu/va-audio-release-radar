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
    storeSection: "home",
    titleRaw: "架空のASMR作品",
    firstSeenAt: "2026-09-18T00:00:00.000Z",
    lastSeenAt: "2026-09-18T00:00:00.000Z",
    ...over,
  };
}

describe("affiliateUrlFor の DLsite", () => {
  it("作品 ID とアフィリエイト ID から dlaf.jp の URL を組み立てる", () => {
    expect(affiliateUrlFor(listing(), ALL_IDS)).toBe(
      "https://dlaf.jp/home/dlaf/=/t/n/link/work/aid/do65m205lfao7/id/RJ01000419.html",
    );
  });

  /** 管理画面が出したリンクの組。所属と `/home/` で作られた product_url が食い違う作品を含む */
  it.each([
    ["girls", "RJ01048863", "girls"],
    ["soft", "VJ012971", "soft"],
    ["bldrama", "BJ02911418", "garumani"],
    ["girlsdrama", "BJ02911418", "garumani"],
  ])("所属 %s の %s はフロア %s のパスにする", (storeSection, storeProductId, floor) => {
    const url = affiliateUrlFor(
      listing({
        storeProductId,
        storeSection,
        productUrl: `https://www.dlsite.com/home/work/=/product_id/${storeProductId}.html`,
      }),
      ALL_IDS,
    );

    expect(url).toBe(
      `https://dlaf.jp/${floor}/dlaf/=/t/n/link/work/aid/do65m205lfao7/id/${storeProductId}.html`,
    );
  });

  it("所属が無いか知らない値なら組み立てない", () => {
    expect(affiliateUrlFor(listing({ storeSection: undefined }), ALL_IDS)).toBeUndefined();
    expect(affiliateUrlFor(listing({ storeSection: "maniax" }), ALL_IDS)).toBeUndefined();
  });

  it("ID が空か空白だけなら組み立てない", () => {
    expect(affiliateUrlFor(listing(), {})).toBeUndefined();
    expect(affiliateUrlFor(listing(), { DLSITE_AFFILIATE_ID: " " })).toBeUndefined();
  });

  /** 作品 ID は外部由来の文字列。区切り文字が混ざってもパスの別の位置に効かないようにする */
  it("ID と作品 ID をパスの 1 区間に閉じ込める", () => {
    expect(affiliateUrlFor(listing({ storeProductId: "RJ1/../x" }), ALL_IDS)).toBe(
      "https://dlaf.jp/home/dlaf/=/t/n/link/work/aid/do65m205lfao7/id/RJ1%2F..%2Fx.html",
    );
  });
});

describe("affiliateUrlFor の組み立て方が無いストア", () => {
  it("ID が入っていても組み立てない", () => {
    expect(
      affiliateUrlFor(listing({ storeSlug: "audible", storeProductId: "B0ABC" }), ALL_IDS),
    ).toBeUndefined();
    expect(
      affiliateUrlFor(listing({ storeSlug: "pokedora", storeProductId: "123" }), ALL_IDS),
    ).toBeUndefined();
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
