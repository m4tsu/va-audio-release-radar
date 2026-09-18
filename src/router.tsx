import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./app/routeTree.gen";

/**
 * TanStack Start のサーバー / クライアント両方のエントリから呼ばれるルーターの生成関数。
 * Start はこのファイル (srcDirectory 直下の router.*) を規約で探し、
 * `getRouter` の戻り値の型から Register の型を組み立てるため、名前と export は変えないこと
 */
export function getRouter() {
  return createRouter({
    routeTree,
    // リンクにカーソル/フォーカスが乗った時点で先読みする
    defaultPreload: "intent",
    scrollRestoration: true,
  });
}
