import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { resetFollowStoreForTest } from "@/app/store/follow-store";
import { resetPushStoreForTest } from "@/app/store/push-store";
import { resetRouterStub } from "@/app/test/router-stub";

/**
 * ルーターは全テストで差し替える。実物は `RouterProvider` の文脈が無いと動かず、
 * テストごとに同じモックを書くとページを切り出すたびに写経が増える。
 * 差し替えの中身は `src/app/test/router-stub.tsx`
 */
vi.mock("@tanstack/react-router", () => import("@/app/test/router-stub"));

/**
 * Radix (`components/ui/select.tsx`) はポインタ捕捉とスクロールの DOM API を呼ぶが、
 * jsdom はどちらも実装していない。無いまま触ると開いた瞬間に例外になるので、
 * 何もしない実装を置く。捕捉の有無で分岐する挙動はこのテストの対象ではない
 */
Element.prototype.hasPointerCapture = () => false;
Element.prototype.setPointerCapture = () => {};
Element.prototype.releasePointerCapture = () => {};
Element.prototype.scrollIntoView = () => {};

afterEach(async () => {
  cleanup();
  resetRouterStub();
  // フォローは zustand のモジュール変数。前のテストで付いた状態を次に持ち越さない。
  // 読み込みが走っていれば終わるまで待つ (待たないと後から `ready` になる)
  await resetFollowStoreForTest();
  // 通知の購読も同じ。外枠を描いたテストが init を走らせ、unsupported が次のテストに残る
  await resetPushStoreForTest();
});
