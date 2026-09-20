import { useFollowStore } from "@/app/store/follow-store";

/**
 * フォローの読み込みを済ませた状態にする。
 *
 * 実際のアプリでは外枠 (`components/app-shell.tsx`) がマウント時に 1 回呼ぶ。
 * ページや部品を単体で描くテストにはその呼び出しが無く、フォローボタンは
 * 読み込み前として disabled のままになる。押せる状態を作るにはここを通す。
 * 後始末は `src/app/test-setup.ts` の afterEach が行う
 */
export async function readyFollowStore(): Promise<void> {
  await useFollowStore.getState().init();
}
