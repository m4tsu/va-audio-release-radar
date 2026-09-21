import { create } from "zustand";
import { PUSH_SUBSCRIPTION_MAX_ACTORS } from "@/domain/types";
import { type FollowedActor, useFollowStore } from "./follow-store";

/**
 * 新作のブラウザ通知 (Web Push) の購読状態。
 *
 * 購読はブラウザ (push service) が持っていて、サーバーはその写しと「追う声優」を持つ。
 * ここが両者をつなぐ 1 箇所で、購読・解除と、購読中にフォローが変わったときの送り直しを行う。
 * フォローの保存 (`follow-store.ts`) はこの存在を知らない。
 *
 * SSR では何も分からないので `status: "idle"` で描き、外枠がマウント後に `init()` を呼ぶ
 * (`components/app-shell.tsx`)。フォロー状態と同じ段取り。
 *
 * server function とその隣のモジュールは使う場所で動的に import する。このモジュールは全テストの土台
 * (`src/app/test-setup.ts`) からも読まれるので、静的に import すると server function の中の
 * `cloudflare:workers` を jsdom が解決しようとして落ちる
 */

/** service worker の置き場所。`public/sw.js` が配信される URL */
export const SERVICE_WORKER_URL = "/sw.js";

export type PushStatus =
  /** SSR とマウント直後。まだ調べていない */
  | "idle"
  /** Web Push の API が無いブラウザ */
  | "unsupported"
  /** 通知が拒否されている。ブラウザの設定を変えてもらうしかない */
  | "denied"
  | "unsubscribed"
  | "subscribed";

/** `unsupported` のときに添える案内。iOS Safari はホーム画面に追加すると対応する */
export type PushGuidance = "ios-add-to-home" | null;

type PushState = {
  status: PushStatus;
  /** 購読・解除の途中。ボタンを二度押させない */
  busy: boolean;
  /** 直前の操作か同期が失敗した。次の操作で消える */
  error: "failed" | null;
  guidance: PushGuidance;
  init: () => Promise<void>;
  subscribe: (vapidPublicKey: string) => Promise<void>;
  unsubscribe: () => Promise<void>;
};

let initPromise: Promise<void> | null = null;
let unwatchFollows: (() => void) | null = null;
/**
 * サーバーへの送り直し。飛んでいる間に届いた変更は 1 回にまとめ、終わってからもう 1 度だけ送る。
 * 送るのは差分ではなく「今のフォロー全部」なので、途中の状態を送る意味が無い
 */
let syncInFlight: Promise<void> | null = null;
let syncRequested = false;

function supported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * iOS / iPadOS の Safari でホーム画面に追加していない状態か。
 * この状態では `PushManager` が無いので `unsupported` になるが、利用者に打てる手がある
 */
function iosWithoutHomeScreen(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  const isIos =
    /iPhone|iPad|iPod/.test(nav.userAgent) ||
    (nav.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1);
  const standalone =
    nav.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches === true;
  return isIos && !standalone;
}

/** この画面を担当する登録。`register()` は scope "/" で行うので、引数なしで同じものが返る */
async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration();
  return registration ? registration.pushManager.getSubscription() : null;
}

/** VAPID の公開鍵 (base64url) を `applicationServerKey` に渡せる形にする */
function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded =
    value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * 既にある購読が今の公開鍵で作られたものか。鍵を入れ替えた後に古い購読を使い続けると、
 * サーバーは新しい秘密鍵で署名するので push service に弾かれ、届かないのに画面は購読中になる。
 * ブラウザが鍵を返さない (null) ときは判定できないので、そのまま使う
 */
function boundToKey(subscription: PushSubscription, key: Uint8Array): boolean {
  const bound = subscription.options?.applicationServerKey;
  if (!bound) return true;
  const current = new Uint8Array(bound);
  return current.length === key.length && current.every((byte, index) => byte === key[index]);
}

function followIds(follows: FollowedActor[]): string[] {
  // 上限を超える分は古い方を落とす (一覧は新しい順)。超える人はまず居ないが、送信を失敗させない
  return follows.slice(0, PUSH_SUBSCRIPTION_MAX_ACTORS).map((actor) => actor.voiceActorId);
}

function followKey(follows: FollowedActor[]): string {
  return follows
    .map((actor) => actor.voiceActorId)
    .sort()
    .join(",");
}

/** 購読の宛先と鍵、今のフォローをサーバーに送る。同じ endpoint なら置き換わる */
async function sendToServer(subscription: PushSubscription): Promise<void> {
  const json = subscription.toJSON();
  const [{ savePushSubscriptionFn }, { localeOnClient }] = await Promise.all([
    import("@/app/server-fns/push"),
    import("@/app/server-fns/locale"),
  ]);
  await savePushSubscriptionFn({
    data: {
      endpoint: subscription.endpoint,
      p256dh: json.keys?.p256dh ?? "",
      auth: json.keys?.auth ?? "",
      locale: localeOnClient(),
      voiceActorIds: followIds(useFollowStore.getState().follows),
    },
  });
}

export const usePushStore = create<PushState>((set, get) => {
  /** 今のフォローをサーバーへ送り直す。飛んでいる最中の要求は 1 回にまとめる */
  const requestSync = () => {
    syncRequested = true;
    if (syncInFlight) return;
    syncInFlight = (async () => {
      while (syncRequested) {
        syncRequested = false;
        try {
          const subscription = await currentSubscription();
          if (subscription && get().status === "subscribed") await sendToServer(subscription);
        } catch {
          // 次のフォロー変更か、次に購読し直したときに追いつく。画面には失敗だけ伝える
          set({ error: "failed" });
        }
      }
    })().finally(() => {
      syncInFlight = null;
    });
  };

  /** 購読中にフォローが変わったら送り直す。購読が成立したときに 1 回だけ張る */
  const watchFollows = () => {
    if (unwatchFollows) return;
    unwatchFollows = useFollowStore.subscribe((state, previous) => {
      if (get().status !== "subscribed") return;
      // 読み込み (idle → ready) で 0 件から埋まるのは変更ではない。サーバーは既に同じ内容を持っている
      if (previous.status !== "ready" || state.status !== "ready") return;
      if (followKey(state.follows) === followKey(previous.follows)) return;
      requestSync();
    });
  };

  return {
    status: "idle",
    busy: false,
    error: null,
    guidance: null,

    init: async () => {
      if (typeof window === "undefined") return;
      initPromise ??= (async () => {
        if (!supported()) {
          set({
            status: "unsupported",
            guidance: iosWithoutHomeScreen() ? "ios-add-to-home" : null,
          });
          return;
        }
        try {
          if (await currentSubscription()) {
            set({ status: "subscribed" });
            watchFollows();
            return;
          }
        } catch {
          // 登録を読めないだけ。未購読として扱い、購読の操作は出す
        }
        set({ status: Notification.permission === "denied" ? "denied" : "unsubscribed" });
      })();
      return initPromise;
    },

    subscribe: async (vapidPublicKey) => {
      if (get().busy) return;
      set({ busy: true, error: null });
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          set({ busy: false, status: permission === "denied" ? "denied" : "unsubscribed" });
          return;
        }
        // 購読して初めて worker を登録する。見に来ただけの人のブラウザに worker を置かない
        await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: "/" });
        const registration = await navigator.serviceWorker.ready;
        const key = base64UrlToBytes(vapidPublicKey);
        let subscription = await registration.pushManager.getSubscription();
        if (subscription && !boundToKey(subscription, key)) {
          await subscription.unsubscribe();
          subscription = null;
        }
        subscription ??= await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        });
        try {
          await sendToServer(subscription);
        } catch {
          // サーバーが知らない購読を残すと、通知は届かないのに画面は購読中になる。ブラウザ側も戻す
          await subscription.unsubscribe().catch(() => {});
          set({ busy: false, status: "unsubscribed", error: "failed" });
          return;
        }
        set({ busy: false, status: "subscribed" });
        watchFollows();
      } catch {
        set({ busy: false, error: "failed" });
      }
    },

    unsubscribe: async () => {
      if (get().busy) return;
      set({ busy: true, error: null });
      try {
        const subscription = await currentSubscription();
        if (subscription) {
          // ブラウザ側を先に解除する。こちらが成立すれば、次に開いたときも「解除済み」と読める。
          // サーバー側の行が残っても、送信で失効 (404 / 410) が返って消える
          await subscription.unsubscribe();
          set({
            busy: false,
            status: Notification.permission === "denied" ? "denied" : "unsubscribed",
          });
          const { deletePushSubscriptionFn } = await import("@/app/server-fns/push");
          await deletePushSubscriptionFn({ data: { endpoint: subscription.endpoint } }).catch(
            () => {
              // 行は送信時に消えるので、解除そのものは成立している。画面に失敗を出さない
            },
          );
          return;
        }
        set({
          busy: false,
          status: Notification.permission === "denied" ? "denied" : "unsubscribed",
        });
      } catch {
        set({ busy: false, error: "failed" });
      }
    },
  };
});

/** テスト用。init の実行済み状態とフォローの監視を捨てる */
export async function resetPushStoreForTest(): Promise<void> {
  await initPromise?.catch(() => {});
  await syncInFlight?.catch(() => {});
  initPromise = null;
  unwatchFollows?.();
  unwatchFollows = null;
  syncInFlight = null;
  syncRequested = false;
  usePushStore.setState({ status: "idle", busy: false, error: null, guidance: null });
}
