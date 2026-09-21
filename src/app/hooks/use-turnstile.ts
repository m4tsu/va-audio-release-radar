import { useCallback, useEffect, useRef, useState } from "react";

/**
 * bot 対策 (Cloudflare Turnstile) の widget を描き、通ったトークンを返す。
 *
 * スクリプトは Cloudflare から読み込むので、必要な画面 (`/contact`) が描かれたときにだけ
 * 足す。`<head>` に常時置くと、全ページが Cloudflare への通信を起こす。
 * 明示描画 (`render=explicit`) を使うのは、React が差し込んだ後の要素に対して
 * 描く時機を自分で決められるようにするため
 */

/** Cloudflare が `window.turnstile` に置く API。使う分だけ宣言する */
type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
    },
  ) => string | undefined;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SCRIPT_ID = "cf-turnstile-api";

export type Turnstile = {
  /** widget を描く場所。空の `<div>` に付ける */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** 検証を通ったトークン。まだ通っていなければ null */
  token: string | null;
  /** 送信後に呼ぶ。トークンは 1 回しか使えないので widget を引き直す */
  reset: () => void;
};

export function useTurnstile(siteKey: string | null): Turnstile {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | undefined>(undefined);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!siteKey || !container) return;

    let cancelled = false;
    void loadTurnstile().then((api) => {
      if (cancelled || !api) return;
      widgetIdRef.current = api.render(container, {
        sitekey: siteKey,
        callback: (value) => setToken(value),
        // 期限切れと失敗はどちらも「通っていない」。送信させずに引き直させる
        "expired-callback": () => setToken(null),
        "error-callback": () => setToken(null),
      });
    });

    return () => {
      cancelled = true;
      const widgetId = widgetIdRef.current;
      if (widgetId !== undefined) window.turnstile?.remove(widgetId);
      widgetIdRef.current = undefined;
    };
  }, [siteKey]);

  const reset = useCallback(() => {
    setToken(null);
    const widgetId = widgetIdRef.current;
    if (widgetId !== undefined) window.turnstile?.reset(widgetId);
  }, []);

  return { containerRef, token, reset };
}

/**
 * スクリプトを 1 度だけ読み込む。読み込みに失敗しても解決する
 * (トークンが出ないので送信が止まる。画面を例外で落とすほどのことではない)
 */
async function loadTurnstile(): Promise<TurnstileApi | undefined> {
  if (typeof window === "undefined") return undefined;
  if (window.turnstile) return window.turnstile;

  await new Promise<void>((resolve) => {
    const existing = document.getElementById(SCRIPT_ID);
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => resolve(), { once: true });
    if (existing) return;

    const added = script as HTMLScriptElement;
    added.id = SCRIPT_ID;
    added.src = SCRIPT_SRC;
    added.async = true;
    document.head.appendChild(added);
  });

  return window.turnstile;
}
