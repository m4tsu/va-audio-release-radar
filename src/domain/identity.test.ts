import { describe, expect, test } from "vitest";
import { resolveCredit } from "./identity.ts";
import type { VoiceActor, VoiceActorAlias } from "./types.ts";

function actor(patch: Partial<VoiceActor> = {}): VoiceActor {
  return {
    id: "va_ueda-reina",
    slug: "ueda-reina",
    canonicalName: "上田麗奈",
    status: "active",
    gender: "female",
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

describe("resolveCredit の異体字", () => {
  test("異体字だけが違う表記を同じ声優に寄せる", () => {
    const amasaki = actor({ id: "va_amasaki", slug: "amasaki-kohei", canonicalName: "天崎滉平" });
    // ポケドラ側の表記は 﨑 (U+FA11)
    const result = resolveCredit("天﨑滉平", [amasaki], []);
    expect(result).toEqual({ voiceActorId: "va_amasaki", confidence: "verified" });
  });

  test("エイリアス側が異体字でも寄せる", () => {
    const hidaka = actor({ id: "va_hidaka", slug: "hidaka-noriko", canonicalName: "日高のり子" });
    const variant = alias({ voiceActorId: "va_hidaka", name: "日髙 のり子" });
    expect(resolveCredit("日高のり子", [hidaka], [variant])).toEqual({
      voiceActorId: "va_hidaka",
      confidence: "verified",
    });
  });

  /**
   * 異体字を畳むぶん、別人が同じ鍵になる可能性は上がる。そのときも誤マッチではなく
   * unmatched に落ちる (取りこぼしを選ぶ) ことを固定する
   */
  test("異体字を畳んだ結果 2 人に当たったら unmatched にする", () => {
    const actors = [
      actor({ id: "va_a", slug: "a", canonicalName: "天崎滉平" }),
      actor({ id: "va_b", slug: "b", canonicalName: "天﨑滉平" }),
    ];
    // 完全一致の段階を通り抜けさせるため、空白入りの表記で引く
    expect(resolveCredit("天\uFA11 滉平", actors, [])).toEqual({ confidence: "unmatched" });
  });

  /**
   * 変換表を広げる判断の安全余裕をここで固定する。
   *
   * 龍 と 竜 のように、旧字体と新字体が別人の名として使い分けられうる組を畳んでも、
   * 両方の人が登録されていれば**どちらにも紐付かず unmatched になる**。
   * 畳み込みで増えるのは誤マッチではなく取りこぼしである、というのが変換表を
   * 常用漢字表の康熙字典体まで広げられる根拠なので、実装ではなくテストで保証する
   */
  test("畳んだ結果 2 人の声優に一致したら、どちらにも紐付けず unmatched にする", () => {
    const actors = [
      actor({ id: "va_ryuta", slug: "ryuta-old", canonicalName: "架空龍太" }),
      actor({ id: "va_ryuta_new", slug: "ryuta-new", canonicalName: "架空竜太" }),
    ];

    // 完全一致の段階を通り抜けさせるため、空白入りの表記で引く
    const result = resolveCredit("架空龍 太", actors, []);

    expect(result).toEqual({ confidence: "unmatched" });
    expect(result.voiceActorId).toBeUndefined();
  });

  test("別字どうしは寄らない (斉藤と斎藤)", () => {
    const saito = actor({ id: "va_saito", slug: "saito", canonicalName: "斉藤壮馬" });
    expect(resolveCredit("斎藤壮馬", [saito], [])).toEqual({ confidence: "unmatched" });
  });
});
