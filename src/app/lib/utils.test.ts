import { describe, expect, test } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  test("後勝ちで Tailwind のクラスを統合する", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  test("falsy な値は無視する", () => {
    expect(cn("a", false, undefined, "b")).toBe("a b");
  });
});
