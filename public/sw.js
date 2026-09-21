/**
 * Web Push を受けて通知を出すだけの service worker。
 *
 * ページの資産はキャッシュしない。オフラインで開けることは目的に無く、キャッシュを持つと
 * デプロイ後も古い画面が出続けて「更新されていない」と見える。fetch イベントも聞かない。
 *
 * 通知の本文は送信側 (Worker の cron) が JSON で組む。形は { title, body, url } で、
 * どれも無ければ既定の文言で出す。どの週に何を送ったかはサーバー側の記録が持つ
 */

const FOLLOWING_PATH = "/following";

self.addEventListener("install", () => {
  // 古い worker を待たずに切り替える。キャッシュを持たないので、途中で替わっても壊れるものが無い
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  const payload = readPayload(event.data);
  const url = typeof payload.url === "string" ? payload.url : FOLLOWING_PATH;
  event.waitUntil(
    self.registration.showNotification(payload.title ?? "Koenect", {
      body: payload.body ?? "",
      // 複数のタブから同じアイコンを参照する。マニフェストと同じファイル
      icon: "/icons/icon-192.png",
      // 同じ週の通知が 2 つ並ばないように、宛先 URL で束ねる
      tag: url,
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? FOLLOWING_PATH, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // 既に開いているタブがあればそこへ移し、無ければ新しく開く
      const existing = clients.find((client) => client.url === url && "focus" in client);
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    }),
  );
});

/**
 * push の本文を読む。JSON でなければ空の object にして、既定の文言に倒す。
 * 送信側の不具合で本文が壊れていても、通知そのものは出す (届いた事実を利用者に見せる)
 */
function readPayload(data) {
  if (!data) return {};
  try {
    const parsed = data.json();
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
