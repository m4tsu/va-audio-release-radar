import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useFollowStore } from "@/app/store/follow-store";
import { resetPushStoreForTest, SERVICE_WORKER_URL, usePushStore } from "@/app/store/push-store";
import { readyFollowStore } from "@/app/test/follow";

/**
 * jsdom には service worker も PushManager も無い。ブラウザが持つ口 (`navigator.serviceWorker`、
 * `window.PushManager`、`Notification`) だけを差し替え、購読の段取りとサーバーへ送る内容を見る
 */

const savePushSubscriptionFn = vi.fn<(input: unknown) => Promise<unknown>>(async () => ({
  voiceActorIds: [],
}));
const deletePushSubscriptionFn = vi.fn<(input: unknown) => Promise<unknown>>(async () => ({
  deleted: true,
}));
vi.mock("@/app/server-fns/push", () => ({
  savePushSubscriptionFn: (input: unknown) => savePushSubscriptionFn(input),
  deletePushSubscriptionFn: (input: unknown) => deletePushSubscriptionFn(input),
}));

const VAPID_KEY = "BExampleKey";
const ALPHA = { voiceActorId: "va_alpha", slug: "alpha", canonicalName: "架空アルファ" };
const BETA = { voiceActorId: "va_beta", slug: "beta", canonicalName: "架空ベータ" };

type FakeSubscription = {
  endpoint: string;
  toJSON: () => { endpoint: string; keys: { p256dh: string; auth: string } };
  unsubscribe: ReturnType<typeof vi.fn>;
};

function fakeSubscription(endpoint = "https://push.example/sub/1"): FakeSubscription {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: "p256dh-key", auth: "auth-secret" } }),
    unsubscribe: vi.fn(async () => true),
  };
}

/** `navigator.serviceWorker` と `Notification` を、購読の有無と許可の状態を決めて置く */
function stubBrowser(options: {
  subscription?: FakeSubscription | null;
  permission?: NotificationPermission;
  requestResult?: NotificationPermission;
  subscribeResult?: FakeSubscription;
}) {
  let current: FakeSubscription | null = options.subscription ?? null;
  const pushManager = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(async () => {
      current = options.subscribeResult ?? fakeSubscription();
      return current;
    }),
  };
  const registration = { pushManager };
  const serviceWorker = {
    getRegistration: vi.fn(async () => registration),
    register: vi.fn(async () => registration),
    ready: Promise.resolve(registration),
  };
  Object.defineProperty(navigator, "serviceWorker", { value: serviceWorker, configurable: true });
  vi.stubGlobal("PushManager", function PushManager() {});
  vi.stubGlobal("Notification", {
    permission: options.permission ?? "default",
    requestPermission: vi.fn(async () => options.requestResult ?? "granted"),
  });
  return { serviceWorker, pushManager };
}

/**
 * userAgent を差し替えたら必ず戻す。Dexie は Safari の判定に userAgent を見て開き方を変えるので、
 * iPhone のままにすると後続のテストでフォローの保存が返ってこなくなる
 */
const originalUserAgent = Object.getOwnPropertyDescriptor(navigator, "userAgent");

function stubUserAgent(value: string) {
  Object.defineProperty(navigator, "userAgent", { value, configurable: true });
}

function restoreUserAgent() {
  if (originalUserAgent) Object.defineProperty(navigator, "userAgent", originalUserAgent);
  else delete (navigator as { userAgent?: string }).userAgent;
}

function removeBrowserPush() {
  delete (navigator as { serviceWorker?: unknown }).serviceWorker;
}

beforeEach(async () => {
  savePushSubscriptionFn.mockClear();
  deletePushSubscriptionFn.mockClear();
  document.documentElement.lang = "ja";
  await readyFollowStore();
});

afterEach(async () => {
  await resetPushStoreForTest();
  removeBrowserPush();
  restoreUserAgent();
  vi.unstubAllGlobals();
});

describe("init", () => {
  test("Web Push の無いブラウザでは unsupported になる", async () => {
    removeBrowserPush();

    await usePushStore.getState().init();

    expect(usePushStore.getState().status).toBe("unsupported");
    expect(usePushStore.getState().guidance).toBeNull();
  });

  test("iOS Safari でホーム画面に追加していなければ、その案内を添える", async () => {
    removeBrowserPush();
    stubUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1",
    );

    await usePushStore.getState().init();

    expect(usePushStore.getState().status).toBe("unsupported");
    expect(usePushStore.getState().guidance).toBe("ios-add-to-home");
  });

  test("既に購読があれば subscribed から始まる", async () => {
    stubBrowser({ subscription: fakeSubscription() });

    await usePushStore.getState().init();

    expect(usePushStore.getState().status).toBe("subscribed");
  });

  test("購読が無く許可も拒否されていれば denied", async () => {
    stubBrowser({ permission: "denied" });

    await usePushStore.getState().init();

    expect(usePushStore.getState().status).toBe("denied");
  });

  test("購読が無く許可を聞いていなければ unsubscribed", async () => {
    stubBrowser({});

    await usePushStore.getState().init();

    expect(usePushStore.getState().status).toBe("unsubscribed");
  });
});

describe("subscribe", () => {
  test("許可されたら worker を登録し、宛先・鍵・言語・フォロー中の声優をサーバーへ送る", async () => {
    const { serviceWorker, pushManager } = stubBrowser({});
    await useFollowStore.getState().follow(ALPHA);
    await usePushStore.getState().init();

    await usePushStore.getState().subscribe(VAPID_KEY);

    expect(serviceWorker.register).toHaveBeenCalledWith(SERVICE_WORKER_URL, { scope: "/" });
    expect(pushManager.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true }),
    );
    expect(savePushSubscriptionFn).toHaveBeenCalledWith({
      data: {
        endpoint: "https://push.example/sub/1",
        p256dh: "p256dh-key",
        auth: "auth-secret",
        locale: "ja",
        voiceActorIds: ["va_alpha"],
      },
    });
    expect(usePushStore.getState().status).toBe("subscribed");
    expect(usePushStore.getState().busy).toBe(false);
  });

  test("フォローが 0 件でも購読できる", async () => {
    stubBrowser({});
    await usePushStore.getState().init();

    await usePushStore.getState().subscribe(VAPID_KEY);

    expect(savePushSubscriptionFn).toHaveBeenCalledWith({
      data: expect.objectContaining({ voiceActorIds: [] }),
    });
    expect(usePushStore.getState().status).toBe("subscribed");
  });

  test("表示言語が英語なら英語で購読する", async () => {
    stubBrowser({});
    document.documentElement.lang = "en";
    await usePushStore.getState().init();

    await usePushStore.getState().subscribe(VAPID_KEY);

    expect(savePushSubscriptionFn).toHaveBeenCalledWith({
      data: expect.objectContaining({ locale: "en" }),
    });
  });

  test("許可を拒否されたら denied になり、サーバーには送らない", async () => {
    const { pushManager } = stubBrowser({ requestResult: "denied" });
    await usePushStore.getState().init();

    await usePushStore.getState().subscribe(VAPID_KEY);

    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(savePushSubscriptionFn).not.toHaveBeenCalled();
    expect(usePushStore.getState().status).toBe("denied");
  });

  /** サーバーが知らない購読は通知が届かない。画面だけ購読中にしない */
  test("サーバーへ送れなかったらブラウザ側の購読も戻し、失敗を出す", async () => {
    const subscription = fakeSubscription();
    stubBrowser({ subscribeResult: subscription });
    savePushSubscriptionFn.mockRejectedValueOnce(new Error("network"));
    await usePushStore.getState().init();

    await usePushStore.getState().subscribe(VAPID_KEY);

    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(usePushStore.getState()).toMatchObject({ status: "unsubscribed", error: "failed" });
  });
});

describe("unsubscribe", () => {
  test("サーバーの購読を消してからブラウザ側を解除する", async () => {
    const subscription = fakeSubscription();
    stubBrowser({ subscription });
    await usePushStore.getState().init();

    await usePushStore.getState().unsubscribe();

    expect(deletePushSubscriptionFn).toHaveBeenCalledWith({
      data: { endpoint: subscription.endpoint },
    });
    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(usePushStore.getState().status).toBe("unsubscribed");
  });

  test("サーバー側を消せなかったら購読中のまま失敗を出す", async () => {
    const subscription = fakeSubscription();
    stubBrowser({ subscription });
    deletePushSubscriptionFn.mockRejectedValueOnce(new Error("network"));
    await usePushStore.getState().init();

    await usePushStore.getState().unsubscribe();

    expect(subscription.unsubscribe).not.toHaveBeenCalled();
    expect(usePushStore.getState()).toMatchObject({ status: "subscribed", error: "failed" });
  });
});

describe("フォローの同期", () => {
  test("購読中にフォローを増減すると、今のフォロー全部を送り直す", async () => {
    stubBrowser({ subscription: fakeSubscription() });
    await useFollowStore.getState().follow(ALPHA);
    await usePushStore.getState().init();

    await useFollowStore.getState().follow(BETA);
    await vi.waitFor(() => expect(savePushSubscriptionFn).toHaveBeenCalledTimes(1));
    expect(savePushSubscriptionFn).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ voiceActorIds: ["va_beta", "va_alpha"] }),
    });

    await useFollowStore.getState().unfollow(ALPHA.voiceActorId);
    await vi.waitFor(() => expect(savePushSubscriptionFn).toHaveBeenCalledTimes(2));
    expect(savePushSubscriptionFn).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ voiceActorIds: ["va_beta"] }),
    });
  });

  test("購読していなければフォローが変わってもサーバーへ送らない", async () => {
    stubBrowser({});
    await usePushStore.getState().init();

    await useFollowStore.getState().follow(ALPHA);
    await Promise.resolve();

    expect(savePushSubscriptionFn).not.toHaveBeenCalled();
  });

  test("解除した後はフォローが変わっても送らない", async () => {
    stubBrowser({ subscription: fakeSubscription() });
    await usePushStore.getState().init();
    await usePushStore.getState().unsubscribe();

    await useFollowStore.getState().follow(ALPHA);
    await Promise.resolve();

    expect(savePushSubscriptionFn).not.toHaveBeenCalled();
  });
});
