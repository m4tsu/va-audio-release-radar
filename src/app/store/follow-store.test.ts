import { beforeEach, describe, expect, test } from "vitest";
import { resetFollowStoreForTest, useFollowStore } from "./follow-store";

/**
 * jsdom には IndexedDB が無いので、Dexie 側は必ず失敗する。
 * 「保存できない環境でも画面の状態は動く」ことをここで確かめている
 */
describe("useFollowStore", () => {
  beforeEach(() => {
    resetFollowStoreForTest();
  });

  test("初期状態は idle でフォロー 0 件 (SSR と同じ形)", () => {
    const state = useFollowStore.getState();
    expect(state.status).toBe("idle");
    expect(state.follows).toEqual([]);
  });

  test("保存先が使えなくても init は ready になる", async () => {
    await useFollowStore.getState().init();
    expect(useFollowStore.getState().status).toBe("ready");
  });

  test("フォローと解除が状態に反映される", async () => {
    const actor = {
      voiceActorId: "va_ueda-reina",
      slug: "ueda-reina",
      canonicalName: "上田麗奈",
    };

    await useFollowStore.getState().follow(actor);
    expect(useFollowStore.getState().isFollowing("va_ueda-reina")).toBe(true);
    expect(useFollowStore.getState().follows).toHaveLength(1);

    await useFollowStore.getState().unfollow("va_ueda-reina");
    expect(useFollowStore.getState().isFollowing("va_ueda-reina")).toBe(false);
    expect(useFollowStore.getState().follows).toEqual([]);
  });

  /** 未読の印はこの値との比較で決まる。保存できない環境でも表示は動かす */
  test("フィードを見た日時は保存先が使えなくても状態に残る", async () => {
    await useFollowStore.getState().init();
    expect(useFollowStore.getState().lastSeenFeedAt).toBeNull();

    await useFollowStore.getState().markFeedSeen("2026-09-18T00:00:00.000Z");
    expect(useFollowStore.getState().lastSeenFeedAt).toBe("2026-09-18T00:00:00.000Z");
  });

  test("同じ声優を二重にフォローしても 1 件のまま", async () => {
    const actor = { voiceActorId: "va_a", slug: "a", canonicalName: "あ" };
    await useFollowStore.getState().follow(actor);
    await useFollowStore.getState().follow(actor);
    expect(useFollowStore.getState().follows).toHaveLength(1);
  });
});
