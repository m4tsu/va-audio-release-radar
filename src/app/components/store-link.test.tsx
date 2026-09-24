import { screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { StoreLink } from "@/app/components/store-link";
import { workListing } from "@/app/test/fixtures";
import { renderWithLocale } from "@/app/test/render";

const PRODUCT_URL = "https://www.dlsite.com/home/work/=/product_id/RJ1.html";

describe("StoreLink の送り先", () => {
  test("アフィリエイト URL が無ければ正規 URL へ送る", () => {
    renderWithLocale(<StoreLink listing={workListing({ productUrl: PRODUCT_URL })} />);

    const link = screen.getByRole("link", { name: "DLsite で見る" });
    expect(link).toHaveAttribute("href", PRODUCT_URL);
    expect(link).toHaveAttribute("rel", "noopener nofollow sponsored");
  });

  test("アフィリエイト URL が https でなければ使わず、正規 URL へ送る", () => {
    renderWithLocale(
      <StoreLink
        listing={workListing({
          productUrl: PRODUCT_URL,
          affiliateUrl: "http://dlaf.jp/home/dlaf/=/t/n/link/work/aid/example/id/RJ1.html",
        })}
      />,
    );

    expect(screen.getByRole("link", { name: "DLsite で見る" })).toHaveAttribute(
      "href",
      PRODUCT_URL,
    );
  });
});

describe("StoreLink の成果計測の画像", () => {
  const POKEDORA_URL = "https://pokedora.com/products/detail.php?product_id=101749";
  const BEACON_URL = "https://ad.jp.ap.valuecommerce.com/servlet/gifbanner?sid=1&pid=2";

  /** alt="" の画像は読み上げ名を持たず role で取れないので、リンクの中を直接見る */
  test("アフィリエイト URL へ送るときは、配られた広告コードのとおりの画像をリンクの中に出す", () => {
    renderWithLocale(
      <StoreLink
        listing={workListing({
          storeSlug: "pokedora",
          productUrl: POKEDORA_URL,
          affiliateUrl: `https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=1&pid=2&vc_url=${encodeURIComponent(POKEDORA_URL)}`,
          affiliateBeaconUrl: BEACON_URL,
        })}
      />,
    );

    const link = screen.getByRole("link", { name: "ポケドラで聴く" });
    expect(link).toHaveAttribute("rel", "noopener nofollow sponsored");
    const beacon = link.querySelector("img");
    expect(beacon).toHaveAttribute("src", BEACON_URL);
    expect(beacon).toHaveAttribute("alt", "");
    expect(beacon).toHaveAttribute("width", "0");
    expect(beacon).toHaveAttribute("height", "1");
    expect(beacon).toHaveAttribute("border", "0");
  });

  test("正規 URL に落ちたリンクには画像を出さない", () => {
    renderWithLocale(
      <StoreLink
        listing={workListing({
          storeSlug: "pokedora",
          productUrl: POKEDORA_URL,
          affiliateUrl: "http://ck.jp.ap.valuecommerce.com/servlet/referral",
          affiliateBeaconUrl: BEACON_URL,
        })}
      />,
    );

    const link = screen.getByRole("link", { name: "ポケドラで聴く" });
    expect(link).toHaveAttribute("href", POKEDORA_URL);
    expect(link.querySelector("img")).toBeNull();
  });
});
