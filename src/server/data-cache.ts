import { env, waitUntil } from "cloudflare:workers";
import { getRequest } from "@tanstack/react-start/server";
import {
  cacheKeyUrl,
  dataCacheEnabled,
  type QueryArgs,
  readDataGeneration,
} from "./data-generation";
import { getDb } from "./db/client";
import { siteOrigin } from "./site";

/**
 * 公開データのクエリ結果を、Worker の Cache API (`caches.default`) に置く。
 *
 * HTML と公開サーバー関数の応答は Worker の前のキャッシュ (Workers Cache、`cache-policy.ts`) に載るが、
 * HTML は表示言語のヘッダの値で版が分かれ、自動巡回の多くは版ごとに描き直させる。描き直しのたびに
 * 同じクエリで D1 を読まないよう、クエリの結果を HTML とは別に持つ。
 *
 * 無効化はデータの世代 (`data_generation` の 1 行、`data-generation.ts`) で行う。データを変えた書き込みの後に
 * 入口 (`src/worker.ts`) が世代を新しくし、キーに世代を入れているので古い結果は以後読まれない。Cache API の消去は
 * データセンター単位でしか届かないので、消す代わりに読まなくする。世代が変わらない変更 (D1 へ直接流した SQL など) は
 * 寿命 (`MAX_AGE_SECONDS`) で止まる。
 *
 * 有効なのは `env.DATA_CACHE` が "1" のときだけ (本番の deploy が渡す)。手元の dev と E2E では
 * キャッシュが永続化される一方で、シードを D1 に直接流すので世代が変わらず、古い結果が返るため
 */

/**
 * 結果の寿命。新着の段と NEW の印は時刻で決まるので、古い結果を使い回すとその分だけずれる。
 * キーに UTC の日付も入れて、日をまたいでは使い回さない
 */
const MAX_AGE_SECONDS = 3600;

export type { QueryArgs };

/**
 * `run` の結果をキャッシュから返すか、`run` を実行して置く。
 *
 * 結果は JSON で往復するので、`undefined` を値に持つキーや Date を返すクエリには使わない
 * (往復で変わらないことは `data-generation.test.ts` が各クエリで確かめる)。
 * キャッシュの読み書きに失敗したら `run` を実行する
 */
export async function cachedQuery<T>(
  name: string,
  args: QueryArgs,
  run: () => Promise<T>,
): Promise<T> {
  if (!dataCacheEnabled(env.DATA_CACHE) || typeof caches === "undefined") return run();

  let key: Request;
  try {
    key = new Request(cacheKeyUrl(siteOrigin(), name, await currentGeneration(), today(), args));
    const hit = await defaultCache().match(key);
    if (hit) return (await hit.json()) as T;
  } catch (error) {
    console.warn("クエリ結果のキャッシュを読めなかった", name, error);
    return run();
  }

  const result = await run();
  const response = new Response(JSON.stringify(result), {
    headers: { "content-type": "application/json", "cache-control": `max-age=${MAX_AGE_SECONDS}` },
  });
  // 置くのは応答を返した後でよい。失敗しても次の読み取りで D1 を読むだけ
  waitUntil(
    defaultCache()
      .put(key, response)
      .catch((error: unknown) => {
        console.warn("クエリ結果をキャッシュに置けなかった", name, error);
      }),
  );
  return result;
}

/**
 * Workers の既定のキャッシュ。型はブラウザの `CacheStorage` と重なって `default` が見えないので、
 * Workers の型 (`worker-configuration.d.ts`) の形で取り出す
 */
function defaultCache(): Cache {
  return (caches as unknown as { default: Cache }).default;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 世代はリクエストごとに 1 回だけ読む (トップは 1 回の描画で新着を 3 回引く)。
 * モジュール変数に寿命なしで置かないのは、Worker のモジュールがリクエストをまたいで生き残り、
 * 書き込みの後も古い世代を使い続けてしまうため
 */
const generationByRequest = new WeakMap<Request, Promise<string>>();

function currentGeneration(): Promise<string> {
  const request = getRequest();
  let generation = generationByRequest.get(request);
  if (generation === undefined) {
    generation = readDataGeneration(getDb());
    generationByRequest.set(request, generation);
  }
  return generation;
}
