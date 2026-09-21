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
  /** ブラウザが購読を作ったときの公開鍵。null は「返さないブラウザ」 */
  options: { applicationServerKey: ArrayBuffer | null };
  toJSON: () => { endpoint: string; keys: { p256dh: string; auth: string } };
  unsubscribe: ReturnType<typeof vi.fn>;
};

/** store と同じ変換。購読が今の鍵で作られたかの比較に使う */
function keyBytes(base64Url: string): ArrayBuffer {
  const padded =
    base64Url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (base64Url.length % 4)) % 4);
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

function fakeSubscription(
  endpoint = "https://push.example/sub/1",
  boundKey: string | null = VAPID_KEY,
): FakeSubscription {
  return {
    endpoint,
    options: { applicationServerKey: boundKey === null ? null : keyBytes(boundKey) },
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

  test("既にある購読が今の公開鍵で作られていれば、そのまま使う", async () => {
    const existing = fakeSubscription("https://push.example/sub/old", VAPID_KEY);
    const { pushManager } = stubBrowser({ subscription: existing });
    usePushStore.setState({ status: "unsubscribed" });

    await usePushStore.getState().subscribe(VAPID_KEY);

    expect(existing.unsubscribe).not.toHaveBeenCalled();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(savePushSubscriptionFn).toHaveBeenCalledWith({
      data: expect.objectContaining({ endpoint: "https://push.example/sub/old" }),
    });
  });

  /** 鍵を入れ替えた後に古い購読を使い続けると、届かないのに画面は購読中になる */
  test("既にある購読が別の公開鍵で作られていれば、解除して作り直す", async () => {
    const stale = fakeSubscription("https://push.example/sub/old", "BOldKey");
    const fresh = fakeSubscription("https://push.example/sub/new", VAPID_KEY);
    const { pushManager } = stubBrowser({ subscription: stale, subscribeResult: fresh });
    usePushStore.setState({ status: "unsubscribed" });

    await usePushStore.getState().subscribe(VAPID_KEY);

    expect(stale.unsubscribe).toHaveBeenCalled();
    expect(pushManager.subscribe).toHaveBeenCalled();
    expect(savePushSubscriptionFn).toHaveBeenCalledWith({
      data: expect.objectContaining({ endpoint: "https://push.example/sub/new" }),
    });
    expect(usePushStore.getState().status).toBe("subscribed");
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
  test("ブラウザ側を解除し、サーバーの購読も消す", async () => {
    const subscription = fakeSubscription();
    stubBrowser({ subscription });
    await usePushStore.getState().init();

    await usePushStore.getState().unsubscribe();

    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(deletePushSubscriptionFn).toHaveBeenCalledWith({
      data: { endpoint: subscription.endpoint },
    });
    expect(usePushStore.getState()).toMatchObject({ status: "unsubscribed", error: null });
  });

  /** サーバーに残った行は送信で失効が返って消える。解除そのものは成立している */
  test("サーバー側を消せなくても解除は成立し、失敗を出さない", async () => {
    const subscription = fakeSubscription();
    stubBrowser({ subscription });
    deletePushSubscriptionFn.mockRejectedValueOnce(new Error("network"));
    await usePushStore.getState().init();

    await usePushStore.getState().unsubscribe();

    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(usePushStore.getState()).toMatchObject({ status: "unsubscribed", error: null });
  });

  /** ブラウザ側が残ると、次に開いたときに購読中と読める。先に解除できなければ何も変えない */
  test("ブラウザ側を解除できなければ購読中のまま失敗を出し、サーバーには触らない", async () => {
    const subscription = fakeSubscription();
    subscription.unsubscribe.mockRejectedValueOnce(new Error("push service"));
    stubBrowser({ subscription });
    await usePushStore.getState().init();

    await usePushStore.getState().unsubscribe();

    expect(deletePushSubscriptionFn).not.toHaveBeenCalled();
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

  /** 外枠は購読とフォローを同時に調べ始める。購読の方が先に済むと、フォローの読み込みが変更に見える */
  test("フォローの読み込み (idle → ready) では送り直さない", async () => {
    stubBrowser({ subscription: fakeSubscription() });
    useFollowStore.setState({ status: "idle", follows: [] });
    await usePushStore.getState().init();

    useFollowStore.setState({
      status: "ready",
      follows: [{ ...ALPHA, createdAt: "2026-09-18T00:00:00.000Z" }],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(savePushSubscriptionFn).not.toHaveBeenCalled();
  });

  /** 送るのは今のフォロー全部なので、飛んでいる間の変更は 1 回にまとめて後から送れば足りる */
  test("送っている最中の変更はまとめて、終わってから 1 回だけ送り直す", async () => {
    stubBrowser({ subscription: fakeSubscription() });
    await usePushStore.getState().init();
    let finishFirst: () => void = () => {};
    savePushSubscriptionFn.mockImplementationOnce(
      () => new Promise<unknown>((resolve) => (finishFirst = () => resolve({ voiceActorIds: [] }))),
    );

    await useFollowStore.getState().follow(ALPHA);
    await vi.waitFor(() => expect(savePushSubscriptionFn).toHaveBeenCalledTimes(1));
    await useFollowStore.getState().follow(BETA);
    await useFollowStore.getState().unfollow(ALPHA.voiceActorId);
    finishFirst();

    await vi.waitFor(() => expect(savePushSubscriptionFn).toHaveBeenCalledTimes(2));
    expect(savePushSubscriptionFn).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ voiceActorIds: ["va_beta"] }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(savePushSubscriptionFn).toHaveBeenCalledTimes(2);
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
