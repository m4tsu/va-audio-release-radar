import { expect, type Page } from "@playwright/test";
import { FOLLOW_DB_NAME, FOLLOWS_TABLE } from "@/app/store/follow-store";

/**
 * フォローが IndexedDB に書き終わるまで待つ。
 *
 * ストアは先に画面を書き換え、保存はそのあと追いかける
 * (`src/app/store/follow-store.ts` の `follow` / `unfollow`)。
 * ボタンが「フォロー中」に変わった時点では保存はまだ終わっておらず、そのまま
 * `page.goto` や `page.reload` をすると書き込みが途中で切れ、読み込み直した先で
 * フォローが消える。読み込み直しをまたいで残ることを見るテストは、先にここで待つ
 */
export async function expectFollowsStored(page: Page, count: number): Promise<void> {
  await expect
    .poll(() => storedFollowCount(page), {
      message: "IndexedDB に保存されたフォローの件数",
      // 既定の 5 秒は、マシンが混んでいるときの書き込みには短い。
      // テスト全体の上限 (playwright.config.ts の timeout) より十分短くしておく
      timeout: 15_000,
    })
    .toBe(count);
}

/** ページの IndexedDB に入っているフォローの件数 */
function storedFollowCount(page: Page): Promise<number> {
  return page.evaluate(
    async ({ dbName, table }) => {
      const settled = <T>(request: IDBRequest<T>) =>
        new Promise<T>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });

      // open() は DB が無ければ空のものを作る。作ると Dexie 側の版上げとぶつかるので、
      // 先に一覧で有無を確かめる
      const databases = await indexedDB.databases();
      if (!databases.some((entry) => entry.name === dbName)) return 0;

      const db = await settled(indexedDB.open(dbName));
      try {
        if (!db.objectStoreNames.contains(table)) return 0;
        const keys = db.transaction(table, "readonly").objectStore(table).getAllKeys();
        return (await settled(keys)).length;
      } finally {
        db.close();
      }
    },
    { dbName: FOLLOW_DB_NAME, table: FOLLOWS_TABLE },
  );
}
