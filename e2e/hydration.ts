import { expect, type Page } from "@playwright/test";

/**
 * クライアントが動き出すまで待つ。
 *
 * 配色が確定すると、ヘッダーの切り替えボタンのラベルが「配色を切り替える」から
 * 押した先の名前に変わる。これを合図に使う。ここより前の入力やクリックは React に届かず、
 * 制御された input なら値ごと戻される
 */
export async function waitForHydration(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: /^(ライト|ダーク)に切り替える$/ })).toBeVisible();
}
