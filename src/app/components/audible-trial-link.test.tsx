import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { AudibleTrialLink } from "@/app/components/audible-trial-link";
import { renderWithLocale } from "@/app/test/render";
import { captureUsageEvents } from "@/app/test/usage-events";

const LINK = {
  url: "https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=1&pid=2",
  beaconUrl: "https://ad.jp.ap.valuecommerce.com/servlet/gifbanner?sid=1&pid=2",
};

describe("AudibleTrialLink", () => {
  test("Amazon のサービスだと分かる文言で、報酬の付くリンクとして出す", () => {
    renderWithLocale(<AudibleTrialLink link={LINK} />);

    const link = screen.getByRole("link", {
      name: "Amazon のオーディオブックサービス Audible の無料体験に登録する",
    });
    expect(link).toHaveAttribute("href", LINK.url);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener nofollow sponsored");
  });

  /** alt="" の画像は読み上げ名を持たず role で取れないので、リンクの中を直接見る */
  test("配られた広告コードのとおりの計測画像をリンクの中に出す", () => {
    renderWithLocale(<AudibleTrialLink link={LINK} />);

    const beacon = screen.getByRole("link").querySelector("img");
    expect(beacon).toHaveAttribute("src", LINK.beaconUrl);
    expect(beacon).toHaveAttribute("alt", "");
    expect(beacon).toHaveAttribute("width", "1");
    expect(beacon).toHaveAttribute("height", "1");
    expect(beacon).toHaveAttribute("border", "0");
  });

  test("URL が https でなければ出さない", () => {
    renderWithLocale(<AudibleTrialLink link={{ ...LINK, url: "http://example.com" }} />);

    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("AudibleTrialLink の送客の計測", () => {
  /** 作品ごとのストアへのリンクとは別の操作として数える。報酬になる経路が違う */
  test("押すと無料体験への送客として数える", async () => {
    const user = userEvent.setup();
    const events = captureUsageEvents();
    renderWithLocale(<AudibleTrialLink link={LINK} />);

    await user.click(screen.getByRole("link"));

    expect(await events.sent()).toEqual([{ type: "audible_trial_click" }]);
  });
});
