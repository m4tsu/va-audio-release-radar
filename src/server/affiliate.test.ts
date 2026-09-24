import { describe, expect, it } from "vitest";
import { affiliateLinkFor, withAffiliateUrls } from "./affiliate";
import type { WorkListing } from "./queries/works";

const ALL_IDS = {
  DLSITE_AFFILIATE_ID: "do65m205lfao7",
  AUDIBLE_AFFILIATE_ID: "audible-id",
  POKEDORA_VC_SID: "3782466",
  POKEDORA_VC_PID: "892711118",
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

const POKEDORA_URL = "https://pokedora.com/products/detail.php?product_id=101749";

function pokedora(over: Partial<WorkListing> = {}): WorkListing {
  return listing({
    storeSlug: "pokedora",
    storeProductId: "101749",
    productUrl: POKEDORA_URL,
    storeSection: "men",
    ...over,
  });
}

describe("affiliateLinkFor の DLsite", () => {
  it("作品 ID とアフィリエイト ID から dlaf.jp の URL を組み立て、計測画像は持たない", () => {
    expect(affiliateLinkFor(listing(), ALL_IDS)).toEqual({
      url: "https://dlaf.jp/home/dlaf/=/t/n/link/work/aid/do65m205lfao7/id/RJ01000419.html",
    });
  });

  /** 管理画面が出したリンクの組。所属と `/home/` で作られた product_url が食い違う作品を含む */
  it.each([
    ["girls", "RJ01048863", "girls"],
    ["soft", "VJ012971", "soft"],
    ["bldrama", "BJ02911418", "garumani"],
    ["girlsdrama", "BJ02911418", "garumani"],
  ])("所属 %s の %s はフロア %s のパスにする", (storeSection, storeProductId, floor) => {
    const link = affiliateLinkFor(
      listing({
        storeProductId,
        storeSection,
        productUrl: `https://www.dlsite.com/home/work/=/product_id/${storeProductId}.html`,
      }),
      ALL_IDS,
    );

    expect(link?.url).toBe(
      `https://dlaf.jp/${floor}/dlaf/=/t/n/link/work/aid/do65m205lfao7/id/${storeProductId}.html`,
    );
  });

  it("所属が無いか知らない値なら組み立てない", () => {
    expect(affiliateLinkFor(listing({ storeSection: undefined }), ALL_IDS)).toBeUndefined();
    expect(affiliateLinkFor(listing({ storeSection: "maniax" }), ALL_IDS)).toBeUndefined();
    expect(affiliateLinkFor(listing({ storeSection: "constructor" }), ALL_IDS)).toBeUndefined();
  });

  it("ID が空か空白だけなら組み立てない", () => {
    expect(affiliateLinkFor(listing(), {})).toBeUndefined();
    expect(affiliateLinkFor(listing(), { DLSITE_AFFILIATE_ID: " " })).toBeUndefined();
  });

  /** 作品 ID は外部由来の文字列。区切り文字が混ざってもパスの別の位置に効かないようにする */
  it("ID と作品 ID をパスの 1 区間に閉じ込める", () => {
    expect(affiliateLinkFor(listing({ storeProductId: "RJ1/../x" }), ALL_IDS)?.url).toBe(
      "https://dlaf.jp/home/dlaf/=/t/n/link/work/aid/do65m205lfao7/id/RJ1%2F..%2Fx.html",
    );
  });
});

describe("affiliateLinkFor のポケドラ", () => {
  /** 管理画面が product_id=101749 に出したコードの href に https: を付けたもの */
  it("作品ページの URL をそのまま vc_url に入れ、管理画面のコードと同じ URL と計測画像を組み立てる", () => {
    expect(affiliateLinkFor(pokedora(), ALL_IDS)).toEqual({
      url: "https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=3782466&pid=892711118&vc_url=https%3A%2F%2Fpokedora.com%2Fproducts%2Fdetail.php%3Fproduct_id%3D101749",
      beaconUrl: "https://ad.jp.ap.valuecommerce.com/servlet/gifbanner?sid=3782466&pid=892711118",
    });
  });

  it("sid と pid のどちらかが空なら組み立てない", () => {
    expect(affiliateLinkFor(pokedora(), { POKEDORA_VC_SID: "3782466" })).toBeUndefined();
    expect(
      affiliateLinkFor(pokedora(), { POKEDORA_VC_SID: " ", POKEDORA_VC_PID: "892711118" }),
    ).toBeUndefined();
  });

  it("作品ページの URL が https でなければ組み立てない", () => {
    expect(
      affiliateLinkFor(
        pokedora({ productUrl: "http://pokedora.com/products/detail.php" }),
        ALL_IDS,
      ),
    ).toBeUndefined();
  });
});

describe("affiliateLinkFor の組み立て方が無いストア", () => {
  it("ID が入っていても組み立てない", () => {
    expect(
      affiliateLinkFor(listing({ storeSlug: "audible", storeProductId: "B0ABC" }), ALL_IDS),
    ).toBeUndefined();
  });
});

describe("withAffiliateUrls", () => {
  it("listing ごとに組み立てた URL と計測画像を付け、組み立てられないストアには付けない", () => {
    const item = withAffiliateUrls(
      {
        listings: [
          listing(),
          pokedora(),
          listing({ storeSlug: "audible", storeProductId: "B0ABC", productUrl: "https://a" }),
        ],
      },
      ALL_IDS,
    );

    expect(item.listings[0]?.affiliateUrl).toBe(
      "https://dlaf.jp/home/dlaf/=/t/n/link/work/aid/do65m205lfao7/id/RJ01000419.html",
    );
    expect(item.listings[0]).not.toHaveProperty("affiliateBeaconUrl");
    expect(item.listings[1]?.affiliateUrl).toMatch(/^https:\/\/ck\.jp\.ap\.valuecommerce\.com\//);
    expect(item.listings[1]?.affiliateBeaconUrl).toBe(
      "https://ad.jp.ap.valuecommerce.com/servlet/gifbanner?sid=3782466&pid=892711118",
    );
    expect(item.listings[2]).not.toHaveProperty("affiliateUrl");
  });
});
