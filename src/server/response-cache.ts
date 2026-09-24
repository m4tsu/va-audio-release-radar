import { setResponseHeader } from "@tanstack/react-start/server";
import { DATA_CHANGED_HEADER, PUBLIC_DATA_HEADER } from "./cache-policy";
import { cachedQuery, type QueryArgs } from "./data-cache";

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

/**
 * 公開データのクエリを実行する。応答に公開データの目印を立て、結果はクエリ結果のキャッシュ
 * (`data-cache.ts`) から返す。`name` と `args` がキャッシュのキーになるので、結果を決める引数はすべて渡す。
 * `run` には D1 のクエリだけを入れ、環境値に依存する加工 (アフィリエイト URL など) は結果を受け取った後で行う。
 * 環境値を変えてデプロイしても、世代が変わらないキャッシュに古い値が残るため
 */
export async function publicQuery<T>(
  name: string,
  args: QueryArgs,
  run: () => Promise<T>,
): Promise<T> {
  markPublicData();
  return cachedQuery(name, args, run);
}

/** 画面に出るデータを書き換えた。入口がキャッシュを消す */
export function markDataChanged(): void {
  setResponseHeader(DATA_CHANGED_HEADER, "1");
}
