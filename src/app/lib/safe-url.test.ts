import { describe, expect, test } from "vitest";
import { safeHttpsUrl } from "./safe-url";

describe("safeHttpsUrl", () => {
  test("https の絶対 URL は通す", () => {
    expect(safeHttpsUrl("https://www.dlsite.com/home/work/=/product_id/RJ01.html")).toBe(
      "https://www.dlsite.com/home/work/=/product_id/RJ01.html",
    );
  });

  test("http・javascript・data は通さない", () => {
    expect(safeHttpsUrl("http://example.com/a.jpg")).toBeUndefined();
    expect(safeHttpsUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeHttpsUrl("data:text/html,<script>alert(1)</script>")).toBeUndefined();
  });

  test("相対 URL・空・未定義は通さない", () => {
    expect(safeHttpsUrl("/works/1")).toBeUndefined();
    expect(safeHttpsUrl("")).toBeUndefined();
    expect(safeHttpsUrl(undefined)).toBeUndefined();
    expect(safeHttpsUrl(null)).toBeUndefined();
  });
});
