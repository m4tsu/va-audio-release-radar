import type { UsageEvent } from "@/contract";

/**
 * Cloudflare Web Analytics の計測スクリプト。ページビュー (指標の分母) を数える。
 * トークンが無ければ読み込まない。SPA の画面遷移もページビューとして送られる
 * (`docs/decisions/0016-count-actions-in-analytics-engine.md`)
 */
export function webAnalyticsScripts(token: string | null) {
  if (!token) return [];
  return [
    {
      src: "https://static.cloudflareinsights.com/beacon.min.js",
      defer: true,
      "data-cf-beacon": JSON.stringify({ token }),
    },
  ];
}

/**
 * 操作を 1 件サーバーへ送る (`POST /api/event`)。指標の分子になる。
 *
 * `sendBeacon` を使うのは、ストアへのリンクは押した直後にページを離れることがあり、
 * 通常の fetch だと送信が打ち切られるため。応答は待たず、失敗しても画面の操作には影響させない
 */
export function sendUsageEvent(event: UsageEvent): void {
  if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") return;
  try {
    navigator.sendBeacon(
      "/api/event",
      new Blob([JSON.stringify(event)], { type: "application/json" }),
    );
  } catch {
    // 数え損ねるだけで、利用者の操作は済んでいる
  }
}

/**
 * 外へ出るリンクに付けるハンドラ。中ボタンで新しいタブに開いた場合も数える
 * (`click` は主ボタンと Enter でしか起きない)
 */
export function countedLinkHandlers(event: UsageEvent) {
  return {
    onClick: () => sendUsageEvent(event),
    onAuxClick: (e: { button: number }) => {
      if (e.button === 1) sendUsageEvent(event);
    },
  };
}
