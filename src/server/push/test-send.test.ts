import { describe, expect, it, vi } from "vitest";
import { getPushSubscription, savePushSubscription } from "../queries/push-subscriptions";
import { setupDb } from "../queries/test-fixtures";
import type { PushSender } from "./send";
import { sendTestPush } from "./test-send";

async function subscribe(locale: "ja" | "en") {
  const db = await setupDb();
  const saved = await savePushSubscription(db, {
    endpoint: "https://push.example/sub/1",
    p256dh: "p256dh",
    auth: "auth",
    locale,
    voiceActorIds: [],
  });
  return { db, saved };
}

describe("sendTestPush", () => {
  it("購読の宛先と鍵へ、購読の言語の文で送る", async () => {
    const { db, saved } = await subscribe("en");
    const send = vi.fn<PushSender>(async () => ({ kind: "sent" }));

    const outcome = await sendTestPush(db, saved.id, send);

    expect(outcome).toEqual({ kind: "sent" });
    expect(send).toHaveBeenCalledWith(
      { endpoint: "https://push.example/sub/1", p256dh: "p256dh", auth: "auth", locale: "en" },
      expect.objectContaining({ title: "Test notification" }),
    );
  });

  it("無い id なら送らない", async () => {
    const { db, saved } = await subscribe("ja");
    const send = vi.fn<PushSender>();

    expect(await sendTestPush(db, saved.id + 1, send)).toEqual({ kind: "not_found" });
    expect(send).not.toHaveBeenCalled();
  });

  it("失効が返っても購読は消さない", async () => {
    const { db, saved } = await subscribe("ja");
    const send = vi.fn<PushSender>(async () => ({ kind: "expired", status: 410 }));

    await sendTestPush(db, saved.id, send);

    expect(await getPushSubscription(db, saved.endpoint)).toBeDefined();
  });
});
