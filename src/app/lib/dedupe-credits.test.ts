import { describe, expect, test } from "vitest";
import { dedupeCredits } from "./dedupe-credits";

type Credit = {
  voiceActorId?: string;
  creditedName: string;
  sourceStoreSlug: "dlsite" | "audible";
};

describe("dedupeCredits", () => {
  test("解決済みは voiceActorId で重複排除し、表記違いでも 1 回だけ残す", () => {
    const credits: Credit[] = [
      { voiceActorId: "va_ueda-reina", creditedName: "上田 麗奈", sourceStoreSlug: "dlsite" },
      { voiceActorId: "va_ueda-reina", creditedName: "上田麗奈", sourceStoreSlug: "dlsite" },
    ];
    expect(dedupeCredits(credits)).toEqual([
      { voiceActorId: "va_ueda-reina", creditedName: "上田 麗奈", sourceStoreSlug: "dlsite" },
    ]);
  });

  test("未解決は creditedName で重複排除する", () => {
    const credits: Credit[] = [
      { creditedName: "知らない人", sourceStoreSlug: "dlsite" },
      { creditedName: "知らない人", sourceStoreSlug: "dlsite" },
    ];
    expect(dedupeCredits(credits)).toEqual([
      { creditedName: "知らない人", sourceStoreSlug: "dlsite" },
    ]);
  });

  test("未解決同士は creditedName が違えば別々に残り、解決済みとは混ざらない", () => {
    const credits: Credit[] = [
      { voiceActorId: "va_ueda-reina", creditedName: "上田麗奈", sourceStoreSlug: "dlsite" },
      { creditedName: "知らない人", sourceStoreSlug: "dlsite" },
      { creditedName: "別の未解決", sourceStoreSlug: "dlsite" },
    ];
    expect(dedupeCredits(credits)).toEqual(credits);
  });

  test("voiceActorId が異なれば両方残す", () => {
    const credits: Credit[] = [
      { voiceActorId: "va_ueda-reina", creditedName: "上田麗奈", sourceStoreSlug: "dlsite" },
      { voiceActorId: "va_hikasa-yoko", creditedName: "日笠陽子", sourceStoreSlug: "dlsite" },
    ];
    expect(dedupeCredits(credits)).toEqual(credits);
  });

  test("最初に出現した項目を残す (順序を保つ)", () => {
    const credits: Credit[] = [
      { voiceActorId: "va_ueda-reina", creditedName: "先に出た表記", sourceStoreSlug: "dlsite" },
      { voiceActorId: "va_ueda-reina", creditedName: "後から出た表記", sourceStoreSlug: "dlsite" },
    ];
    expect(dedupeCredits(credits)).toEqual([
      { voiceActorId: "va_ueda-reina", creditedName: "先に出た表記", sourceStoreSlug: "dlsite" },
    ]);
  });

  test("keySelector を渡すと別の形の配列にも適用できる (work-card の actors 用)", () => {
    const actors = [
      { id: "va_ueda-reina", slug: "ueda-reina", name: "上田麗奈" },
      { id: "va_ueda-reina", slug: "ueda-reina", name: "上田 麗奈" },
      { id: "va_hikasa-yoko", slug: "hikasa-yoko", name: "日笠陽子" },
    ];
    expect(
      dedupeCredits(actors, (actor) => ({ voiceActorId: actor.id, creditedName: actor.name })),
    ).toEqual([
      { id: "va_ueda-reina", slug: "ueda-reina", name: "上田麗奈" },
      { id: "va_hikasa-yoko", slug: "hikasa-yoko", name: "日笠陽子" },
    ]);
  });
});
