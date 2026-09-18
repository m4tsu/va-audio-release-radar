import { describe, expect, test } from "vitest";
import { resolveCredit } from "./identity.ts";
import type { VoiceActor, VoiceActorAlias } from "./types.ts";

function actor(patch: Partial<VoiceActor> = {}): VoiceActor {
  return {
    id: "va_ueda-reina",
    slug: "ueda-reina",
    canonicalName: "上田麗奈",
    status: "active",
    ...patch,
  };
}

function alias(patch: Partial<VoiceActorAlias> = {}): VoiceActorAlias {
  return {
    voiceActorId: "va_ueda-reina",
    name: "上田 麗奈",
    source: "store",
    verified: false,
    ...patch,
  };
}

describe("resolveCredit", () => {
  test("canonicalName と完全一致すれば verified", () => {
    const result = resolveCredit("上田麗奈", [actor()], []);
    expect(result).toEqual({ voiceActorId: "va_ueda-reina", confidence: "verified" });
  });

  test("検証済みエイリアスと完全一致すれば verified", () => {
    const result = resolveCredit("上田 麗奈", [actor()], [alias({ verified: true })]);
    expect(result).toEqual({ voiceActorId: "va_ueda-reina", confidence: "verified" });
  });

  test("未検証エイリアスでも、正規化して一致すれば verified になる (表記揺れの吸収)", () => {
    const result = resolveCredit("上田 麗奈", [actor()], [alias({ verified: false })]);
    expect(result).toEqual({ voiceActorId: "va_ueda-reina", confidence: "verified" });
  });

  test("正規化した結果が canonicalName と一致すれば verified", () => {
    const result = resolveCredit("上田・麗奈", [actor()], []);
    expect(result).toEqual({ voiceActorId: "va_ueda-reina", confidence: "verified" });
  });

  test("前置語 (CV.) が付いていると一致しない", () => {
    const result = resolveCredit("CV.上田麗奈", [actor()], []);
    expect(result).toEqual({ confidence: "unmatched" });
  });

  test("誰にも一致しなければ unmatched", () => {
    const result = resolveCredit("未知の名前", [actor()], []);
    expect(result).toEqual({ confidence: "unmatched" });
  });

  test("空文字はどの声優にも一致しない", () => {
    const result = resolveCredit("", [actor()], []);
    expect(result).toEqual({ confidence: "unmatched" });
  });

  test("同名の声優が複数いる場合は誤マッチせず unmatched にする (canonicalName の完全一致)", () => {
    const actors = [
      actor({ id: "va_a", slug: "a" }),
      actor({ id: "va_b", slug: "b", canonicalName: "上田麗奈" }),
    ];
    const result = resolveCredit("上田麗奈", actors, []);
    expect(result).toEqual({ confidence: "unmatched" });
  });

  test("同名の声優が複数いる場合は誤マッチせず unmatched にする (検証済みエイリアスの完全一致)", () => {
    const actors = [actor({ id: "va_a", slug: "a" }), actor({ id: "va_b", slug: "b" })];
    const aliases = [
      alias({ voiceActorId: "va_a", verified: true }),
      alias({ voiceActorId: "va_b", verified: true }),
    ];
    const result = resolveCredit("上田 麗奈", actors, aliases);
    expect(result).toEqual({ confidence: "unmatched" });
  });

  test("同名の声優が複数いる場合は誤マッチせず unmatched にする (正規化後の一致)", () => {
    const actors = [
      actor({ id: "va_a", slug: "a", canonicalName: "上田 麗奈" }),
      actor({ id: "va_b", slug: "b", canonicalName: "上田・麗奈" }),
    ];
    const result = resolveCredit("上田麗奈", actors, []);
    expect(result).toEqual({ confidence: "unmatched" });
  });

  test("同一声優への完全一致とエイリアス一致が重なっても ambiguous 扱いにはしない", () => {
    // canonicalName の完全一致が同一声優 1 件に絞れているので、後続のエイリアス段階は見ない
    const result = resolveCredit("上田麗奈", [actor()], [alias({ verified: true })]);
    expect(result).toEqual({ voiceActorId: "va_ueda-reina", confidence: "verified" });
  });
});
