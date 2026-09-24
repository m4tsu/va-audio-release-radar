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
