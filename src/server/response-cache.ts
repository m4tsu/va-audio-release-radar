import { setResponseHeader } from "@tanstack/react-start/server";
import { DATA_CHANGED_HEADER, PUBLIC_DATA_HEADER } from "./cache-policy";

/**
 * サーバー関数がキャッシュの扱いを名乗る。入口 (`src/worker.ts`) が目印を読んで
 * ヘッダに写し、目印そのものは外に出さない (判定は `cache-policy.ts`)。
 *
 * SSR の中で呼ばれたときは HTML の応答に目印が立つが、HTML の扱いは入口がパスで決めるので影響しない
 */

/** 誰が引いても同じ結果になる公開データ。cookie・認証・リクエストのホストに依存する関数では呼ばない */
export function markPublicData(): void {
  setResponseHeader(PUBLIC_DATA_HEADER, "public");
}

/** 画面に出るデータを書き換えた。入口がキャッシュを消す */
export function markDataChanged(): void {
  setResponseHeader(DATA_CHANGED_HEADER, "1");
}
