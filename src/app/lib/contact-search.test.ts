import { describe, expect, test } from "vitest";
import {
  contactSearch,
  contactTargetUrl,
  DEFAULT_INQUIRY_KIND,
  readContactSearch,
} from "@/app/lib/contact-search";

describe("readContactSearch", () => {
  test("欄が無ければ既定の種別で、対象のページは無い", () => {
    expect(readContactSearch({})).toEqual({ kind: DEFAULT_INQUIRY_KIND, about: null });
  });

  test("種別と対象のページを読む", () => {
    expect(readContactSearch({ kind: "correction", about: "/voice-actors/alpha" })).toEqual({
      kind: "correction",
      about: "/voice-actors/alpha",
    });
  });

  test("知らない種別は既定に落とす", () => {
    expect(readContactSearch({ kind: "unknown-kind" }).kind).toBe(DEFAULT_INQUIRY_KIND);
  });

  /** 本文の先頭に他所の URL を仕込ませないための境界。オリジンは画面側が付ける */
  test.each([
    ["別オリジンの URL", "https://example.com/works/1"],
    ["プロトコル相対の URL", "//example.com/works/1"],
    ["円記号で始まる経路", "/\\example.com"],
    ["相対パス", "works/1"],
    ["文字列でない値", 1],
    ["改行を含む経路", "/works/1\n\n本文に見せかけた行"],
    ["本文の上限を超える長さの経路", `/works/${"a".repeat(2001)}`],
  ])("%s は対象のページとして読まない", (_name, about) => {
    expect(readContactSearch({ about }).about).toBeNull();
  });
});

describe("contactSearch", () => {
  test("既定の種別は欄ごと落とす", () => {
    expect(contactSearch({ kind: DEFAULT_INQUIRY_KIND })).toEqual({});
  });

  test("読めない値は欄ごと落とす", () => {
    expect(contactSearch({ kind: "unknown-kind", about: "https://example.com" })).toEqual({});
  });

  test("既定でない種別と、このサイトの経路は残す", () => {
    expect(contactSearch({ kind: "correction", about: "/works/dlsite%3ARJ1" })).toEqual({
      kind: "correction",
      about: "/works/dlsite%3ARJ1",
    });
  });
});

describe("contactTargetUrl", () => {
  test("オリジンが取れていれば絶対 URL にする", () => {
    expect(contactTargetUrl("https://example.test", "/works/dlsite%3ARJ1")).toBe(
      "https://example.test/works/dlsite%3ARJ1",
    );
  });

  test("オリジンが取れていなければ経路のまま返す", () => {
    expect(contactTargetUrl("", "/works/dlsite%3ARJ1")).toBe("/works/dlsite%3ARJ1");
  });

  test("対象のページが無ければ null", () => {
    expect(contactTargetUrl("https://example.test", null)).toBeNull();
  });
});
