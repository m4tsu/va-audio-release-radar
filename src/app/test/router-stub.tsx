import type { AnchorHTMLAttributes, ReactNode } from "react";

/**
 * jsdom のテストで `@tanstack/react-router` の代わりに使う差し替え。
 * `src/app/test-setup.ts` が `vi.mock` でこのモジュールを全テストに差し込む。
 *
 * 実物は `RouterProvider` の文脈が無いと動かないが、`src/app/pages/**` と
 * `src/app/components/**` が使うのは `Link` と `useRouter` と `Outlet` だけなので、
 * 行き先が読める `<a>` と、呼ばれた回数を数えるだけの router で足りる。
 * ルート (`src/app/routes/**`) は jsdom で描かないので `createFileRoute` は要らない
 */

/**
 * `to` のパスパラメータを `params` で埋める。
 *
 * 実物と違って符号化はしない。`/works/$id` に "dlsite:RJ1" を渡すと
 * "/works/dlsite:RJ1" になる。テストで見たいのは行き先であって URL の符号化ではなく、
 * 符号化された形は e2e (sitemap と作品ページ) が見ている
 */
export function resolveHref(to: string, params?: Record<string, string>): string {
  return to.replace(/\$([A-Za-z0-9_]+)/g, (whole, key: string) => params?.[key] ?? whole);
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  to: string;
  params?: Record<string, string>;
  children?: ReactNode;
  /** 実物が現在地に応じて付け替える props。どこに居るかを持たないので受け取って捨てる */
  activeProps?: { className?: string };
  inactiveProps?: { className?: string };
  activeOptions?: unknown;
};

export function Link({
  to,
  params,
  activeProps,
  inactiveProps,
  activeOptions,
  ...rest
}: LinkProps) {
  // 受け取って捨てる props。`<a>` に渡すと React が未知の属性として警告する
  void activeProps;
  void inactiveProps;
  void activeOptions;
  return <a href={resolveHref(to, params)} {...rest} />;
}

/** `useRouter().invalidate()` が呼ばれた回数。再取得を促したかをテストから読む */
export const routerStub = { invalidateCount: 0 };

export function resetRouterStub(): void {
  routerStub.invalidateCount = 0;
}

export function useRouter() {
  return {
    invalidate: async () => {
      routerStub.invalidateCount += 1;
    },
  };
}

/** 子ルートの差し込み口。外枠だけを描くテストでは中身を持たない */
export function Outlet() {
  return null;
}
