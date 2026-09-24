/**
 * 応答を Cloudflare のキャッシュ (Workers Cache) に載せてよいかを、応答ごとに決める。
 *
 * Workers Cache は Worker の前にあり、ヒットした応答は Worker を起動せずに返す (D1 も読まない)。
 * `Cache-Control` の無い応答まで推定の寿命でキャッシュするので、ここで全応答に明示する。
 * 既定は `no-store` で、公開してよいと分かっている応答だけをキャッシュ可にする。
 * キャッシュの有効化は `wrangler.jsonc` の `cache`、呼び出しは `src/worker.ts`。
 *
 * キャッシュ可にするもの:
 * - 公開ページの HTML。表示言語が cookie と `Accept-Language` で変わるので、その 2 つで版を分ける
 * - 公開データのサーバー関数。関数の中で `markPublicData` (`response-cache.ts`) が目印を立てたものだけ。
 *   関数 ID は URL からは読めないので、関数の側で名乗らせる
 * - sitemap / robots
 *
 * キャッシュ不可の応答は `no-store` にする。ただし応答が自分で `private` を名乗っていればそのまま残す
 * (manifest は言語 cookie で変わるので、共有キャッシュには載せずブラウザにだけ持たせている)。
 *
 * 寿命は Cloudflare にだけ渡し (`cloudflare-cdn-cache-control` は Cloudflare が消費してブラウザに届かない)、
 * ブラウザには `no-cache` を返す。取り込みの後にキャッシュを消しても、ブラウザに古い版が残らないようにするため
 */

/** 公開データのサーバー関数が応答に立てる目印。入口で読んで消す */
export const PUBLIC_DATA_HEADER = "x-koetrail-cache";
/**
 * 画面に出るデータを書き換えた書き込み (管理 API・管理画面のサーバー関数) が応答に立てる目印。
 * 値が `purge` (と `markDataChanged` の "1") なら、入口がクエリ結果のキャッシュの世代を上げてから Worker の前の
 * キャッシュを消す。`refresh` なら世代だけを上げる。
 * パスで決めないのは、取り込みの多くは何も変えずに終わるため。前のキャッシュを消す API は回数に上限があり、
 * 変えるたびに消すとすぐに使い切る。世代の書き換えは 1 行の書き込みで上限が無い
 */
export const DATA_CHANGED_HEADER = "x-koetrail-data-changed";

/**
 * Cloudflare 側の寿命。データは取り込みのたびに消すので、寿命は消し損ねたときの古さの上限になる。
 * 消す API は 1 分に 5 回までで、クローラーの取り込みが続くと消し損ねる。
 * 寿命の後も 1 日は古い版を即座に返し、裏で作り直す (最初の 1 人を待たせない)
 */
export const CDN_CACHE_CONTROL = "max-age=3600, stale-while-revalidate=86400";

const CACHEABLE_FILES = new Set(["/sitemap.xml", "/robots.txt"]);

/**
 * 管理 API が書き込みの結果を返すときに添えるヘッダ。サーバー関数からは `markDataChanged` (`response-cache.ts`) を使う。
 *
 * - `changed`: 画面の並びが変わる書き込み (新しい作品など)。入口がすべてのキャッシュを消す
 * - `touched`: 既存の行を書き換えた書き込み (発売日の補完、credit の解決など)。クエリ結果のキャッシュの世代だけ上げる。
 *   Worker の前のキャッシュは寿命で入れ替わり、そのときクエリ結果は新しい世代から作り直される
 */
export function dataChangedHeaders(changed: boolean, touched = changed): Record<string, string> {
  if (changed) return { [DATA_CHANGED_HEADER]: "purge" };
  return touched ? { [DATA_CHANGED_HEADER]: "refresh" } : {};
}

export type CacheDecision = {
  /** キャッシュ可なら true。false なら `no-store` を付ける (`private` の応答はそのまま) */
  cacheable: boolean;
  /** キャッシュ可のときの `Vary`。版を分けないなら undefined */
  vary?: string;
  /** この応答の後で、クエリ結果のキャッシュの世代を上げてから Worker の前のキャッシュを消すか */
  purge: boolean;
  /** この応答の後で、クエリ結果のキャッシュの世代だけを上げるか (`purge` のときは含む) */
  refresh?: boolean;
};

export function decideCache(request: Request, response: Response): CacheDecision {
  const { pathname } = new URL(request.url);
  const readOnly = request.method === "GET" || request.method === "HEAD";

  if (!readOnly) {
    const mark = response.ok ? response.headers.get(DATA_CHANGED_HEADER) : null;
    if (mark === "refresh") return { cacheable: false, purge: false, refresh: true };
    return { cacheable: false, purge: mark !== null };
  }

  const notCacheable: CacheDecision = { cacheable: false, purge: false };
  // 200 以外 (404 やリダイレクト) は載せない。一時的な失敗や、まだ無いページを長く残さないため
  if (response.status !== 200) return notCacheable;
  // cookie を立てる応答は人ごとに違う。Workers Cache も保存しないが、ここでも明示する
  if (response.headers.has("set-cookie")) return notCacheable;
  if (pathname.startsWith("/admin") || pathname.startsWith("/api/")) return notCacheable;

  if (pathname.startsWith("/_serverFn/")) {
    // キャッシュのキーは URL だけで、リクエストのヘッダを含まない。TanStack Start は `x-tsr-serverFn` の
    // 無いリクエストに別の形 (直列化しない素の値) で返すので、それを載せると同じ URL を引く画面が壊れる。
    // 画面の取得 (ヘッダ付き) への応答だけを載せる
    const fromClient = request.headers.get("x-tsr-serverFn") === "true";
    return {
      cacheable: fromClient && response.headers.get(PUBLIC_DATA_HEADER) === "public",
      purge: false,
    };
  }
  if (CACHEABLE_FILES.has(pathname)) return { cacheable: true, purge: false };
  if (response.headers.get("content-type")?.startsWith("text/html")) {
    return { cacheable: true, vary: "Cookie, Accept-Language", purge: false };
  }
  return notCacheable;
}

/** 判定をヘッダに写した応答を返す。目印のヘッダは外に出さない */
export function applyCacheDecision(response: Response, decision: CacheDecision): Response {
  const headers = new Headers(response.headers);
  headers.delete(PUBLIC_DATA_HEADER);
  headers.delete(DATA_CHANGED_HEADER);

  if (decision.cacheable) {
    headers.set("cloudflare-cdn-cache-control", CDN_CACHE_CONTROL);
    // ブラウザ向けの指定を自分で持つ応答 (sitemap / robots) はそれを残す
    if (!headers.has("cache-control")) headers.set("cache-control", "no-cache");
    // 応答が持っている Vary (圧縮など) は残して足す
    if (decision.vary) headers.append("vary", decision.vary);
  } else {
    headers.delete("cloudflare-cdn-cache-control");
    if (!/\bprivate\b/.test(headers.get("cache-control") ?? "")) {
      headers.set("cache-control", "no-store");
    }
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
