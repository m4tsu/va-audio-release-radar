import { describe, expect, it } from "vitest";
import type { PushSubscriptionInput } from "@/domain/types";
import {
  deletePushSubscription,
  getPushSubscription,
  savePushSubscription,
} from "./push-subscriptions";
import { HANAZAWA, NOW, setupDb, UEDA } from "./test-fixtures";

function input(overrides: Partial<PushSubscriptionInput> = {}): PushSubscriptionInput {
  return {
    endpoint: "https://push.example/sub/1",
    p256dh: "p256dh-key",
    auth: "auth-secret",
    locale: "ja",
    voiceActorIds: [UEDA.id],
    ...overrides,
  };
}

describe("savePushSubscription", () => {
  it("購読と追う声優を保存し、endpoint で引ける", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);

    const saved = await savePushSubscription(
      db,
      input({ voiceActorIds: [HANAZAWA.id, UEDA.id] }),
      NOW,
    );

    expect(saved.voiceActorIds).toEqual([HANAZAWA.id, UEDA.id]);
    expect(await getPushSubscription(db, saved.endpoint)).toEqual({
      id: saved.id,
      endpoint: saved.endpoint,
      locale: "ja",
      voiceActorIds: [HANAZAWA.id, UEDA.id].sort(),
    });
  });

  /** ブラウザは差分ではなく今のフォロー全部を送る。同じ endpoint は 1 行のまま中身が入れ替わる */
  it("同じ endpoint を送り直すと行は増えず、追う声優が置き換わる", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    const first = await savePushSubscription(db, input({ voiceActorIds: [UEDA.id] }), NOW);

    const second = await savePushSubscription(
      db,
      input({ voiceActorIds: [HANAZAWA.id], locale: "en", p256dh: "rotated" }),
      "2026-09-19T00:00:00.000Z",
    );

    expect(second.id).toBe(first.id);
    expect(await getPushSubscription(db, first.endpoint)).toMatchObject({
      locale: "en",
      voiceActorIds: [HANAZAWA.id],
    });
  });

  it("フォローが 0 件でも購読は保存される", async () => {
    const db = await setupDb();

    const saved = await savePushSubscription(db, input({ voiceActorIds: [] }), NOW);

    expect(saved.voiceActorIds).toEqual([]);
    expect(await getPushSubscription(db, saved.endpoint)).toMatchObject({ voiceActorIds: [] });
  });

  /** 別の環境から持ち込んだ ID で全体が落ちるより、知っている分だけ追う */
  it("存在しない声優 ID は落とし、知っている声優だけ追う", async () => {
    const db = await setupDb([UEDA]);

    const saved = await savePushSubscription(
      db,
      input({ voiceActorIds: ["va_missing", UEDA.id, UEDA.id] }),
      NOW,
    );

    expect(saved.voiceActorIds).toEqual([UEDA.id]);
  });

  it("端末ごとの endpoint は別の購読になる", async () => {
    const db = await setupDb([UEDA]);
    await savePushSubscription(db, input({ endpoint: "https://push.example/sub/pc" }), NOW);
    await savePushSubscription(db, input({ endpoint: "https://push.example/sub/phone" }), NOW);

    expect(await getPushSubscription(db, "https://push.example/sub/pc")).toBeDefined();
    expect(await getPushSubscription(db, "https://push.example/sub/phone")).toBeDefined();
  });
});

describe("deletePushSubscription", () => {
  it("購読を消すと引けなくなり、追う声優も残らない", async () => {
    const db = await setupDb([UEDA]);
    const saved = await savePushSubscription(db, input(), NOW);

    expect(await deletePushSubscription(db, saved.endpoint)).toBe(true);

    expect(await getPushSubscription(db, saved.endpoint)).toBeUndefined();
    // 消した後に同じ endpoint を保存し直しても、古い対が残っていれば重複で落ちる
    const again = await savePushSubscription(db, input(), NOW);
    expect(again.voiceActorIds).toEqual([UEDA.id]);
  });

  it("無い endpoint を消しても失敗せず false を返す", async () => {
    const db = await setupDb();

    expect(await deletePushSubscription(db, "https://push.example/sub/none")).toBe(false);
  });
});
