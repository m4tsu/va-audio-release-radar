import { describe, expect, it } from "vitest";
import { allowIndexing, robotsTxt } from "./robots";

describe("allowIndexing", () => {
  it("1 のときだけ載せてよいとする", () => {
    expect(allowIndexing("1")).toBe(true);
    expect(allowIndexing(" 1 ")).toBe(true);
  });

  /** 設定を忘れたまま公開されるより、公開したのに載らないほうが気づきやすい */
  it("未設定・空・それ以外は載せない", () => {
    expect(allowIndexing(undefined)).toBe(false);
    expect(allowIndexing("")).toBe(false);
    expect(allowIndexing("true")).toBe(false);
    expect(allowIndexing("0")).toBe(false);
  });
});

describe("robotsTxt", () => {
  it("公開前は全部を拒否し、sitemap の在り処も出さない", () => {
    const body = robotsTxt({ origin: "https://example.com", allowIndexing: false });

    expect(body).toBe("User-agent: *\nDisallow: /\n");
    expect(body).not.toContain("Sitemap");
  });

  it("公開後は管理画面と JSON API だけ拒否し、sitemap を示す", () => {
    const body = robotsTxt({ origin: "https://example.com", allowIndexing: true });

    expect(body).toBe(
      "User-agent: *\nDisallow: /admin/\nDisallow: /api/\n\nSitemap: https://example.com/sitemap.xml\n",
    );
  });
});
