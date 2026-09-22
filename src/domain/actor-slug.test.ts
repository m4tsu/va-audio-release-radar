import { describe, expect, it } from "vitest";
import {
  isSingleWordFullName,
  slugWithStaffId,
  toActorId,
  toActorNameEn,
  toActorSlug,
} from "./actor-slug.ts";

describe("toActorSlug", () => {
  it("名-姓 を 姓-名 にして小文字化する", () => {
    expect(toActorSlug("Reina Ueda")).toBe("ueda-reina");
  });

  it("AniList のワープロ式表記をそのまま使い、長音を潰さない", () => {
    // 「ou」「uu」が長音とは限らない (井上 = Inoue) ので、機械的に潰すと別の名前を壊す
    expect(toActorSlug("Akari Kitou")).toBe("kitou-akari");
    expect(toActorSlug("Aoi Yuuki")).toBe("yuuki-aoi");
    expect(toActorSlug("Souma Saitou")).toBe("saitou-souma");
  });

  it("3 語以上なら最後の語を姓、残りを名として前から並べる", () => {
    expect(toActorSlug("Sarah Emi Bridcutt")).toBe("bridcutt-sarah-emi");
  });

  it("改行や記号が混ざっていても落とす", () => {
    expect(toActorSlug("Makoto\r\n Takahashi")).toBe("takahashi-makoto");
    expect(toActorSlug("Debi-Debi Debiru")).toBe("debiru-debidebi");
  });

  it("1 語ならその語をそのまま slug にする (ゆかな・麦人・KENN のような名義)", () => {
    expect(toActorSlug("Yukana")).toBe("yukana");
    expect(toActorSlug("Mugihito")).toBe("mugihito");
    expect(toActorSlug("KENN")).toBe("kenn");
  });

  it("記号が混ざっていても中身が残れば slug にする", () => {
    // "!" は落ちるが "kukkii" は残るので、1 語の名義として slug になる
    expect(toActorSlug("Kukkii!")).toBe("kukkii");
  });

  it("空、または記号だけで中身が残らないなら slug を作らない", () => {
    expect(toActorSlug("   ")).toBeUndefined();
    expect(toActorSlug("!!!")).toBeUndefined();
    expect(toActorSlug(undefined)).toBeUndefined();
  });
});

describe("toActorNameEn", () => {
  it("AniList の表記をそのまま返す", () => {
    expect(toActorNameEn("Reina Ueda")).toBe("Reina Ueda");
  });

  it("ワープロ式のつづりを詰めない", () => {
    // 「ou」「uu」が長音とは限らない (Inoue / Matsuura)。寄せるかどうかは人が overrides で決める
    expect(toActorNameEn("Youko Hikasa")).toBe("Youko Hikasa");
    expect(toActorNameEn("Miyu Inoue")).toBe("Miyu Inoue");
  });

  it("改行と連続した空白を 1 つの空白に詰める", () => {
    expect(toActorNameEn("Makoto\r\n Takahashi")).toBe("Makoto Takahashi");
    expect(toActorNameEn("Jun  Kasama")).toBe("Jun Kasama");
    expect(toActorNameEn("Yui Tsukada ")).toBe("Yui Tsukada");
  });

  it("fullName が無い / 空白だけなら undefined", () => {
    expect(toActorNameEn(undefined)).toBeUndefined();
    expect(toActorNameEn("   ")).toBeUndefined();
  });
});

describe("slugWithStaffId", () => {
  it("staff id を付けた slug にする (連番を振らない)", () => {
    expect(slugWithStaffId("minami-haruka", 118602)).toBe("minami-haruka-118602");
  });
});

describe("toActorId", () => {
  it("slug から声優 ID を作る", () => {
    expect(toActorId("ueda-reina")).toBe("va_ueda-reina");
  });
});

describe("isSingleWordFullName", () => {
  it("1 語の名義を見分ける", () => {
    expect(isSingleWordFullName("Yukana")).toBe(true);
    expect(isSingleWordFullName("Reina Ueda")).toBe(false);
    expect(isSingleWordFullName(undefined)).toBe(false);
  });
});
