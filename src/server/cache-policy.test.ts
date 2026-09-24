import { describe, expect, it } from "vitest";
import {
  applyCacheDecision,
  CDN_CACHE_CONTROL,
  DATA_CHANGED_HEADER,
  dataChangedHeaders,
  decideCache,
  PUBLIC_DATA_HEADER,
} from "./cache-policy";

const ORIGIN = "https://koetrail.com";

function get(path: string): Request {
  return new Request(`${ORIGIN}${path}`);
}

/** 画面がサーバー関数を呼ぶときの形。TanStack Start はこのヘッダで応答の形を決める */
function serverFn(path: string, headers: Record<string, string> = { "x-tsr-serverFn": "true" }) {
  return new Request(`${ORIGIN}${path}`, { headers });
}

function post(path: string): Request {
  return new Request(`${ORIGIN}${path}`, { method: "POST" });
}

function html(status = 200, headers: Record<string, string> = {}): Response {
  return new Response("<!doctype html>", {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
  });
}

function json(headers: Record<string, string> = {}, status = 200): Response {
  return new Response("{}", {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("decideCache", () => {
  it("公開ページの HTML は、言語を決める cookie と Accept-Language で版を分けてキャッシュする", () => {
    for (const path of ["/", "/anime", "/voice-actors/ueda-reina", "/works/dlsite:RJ1"]) {
      expect(decideCache(get(path), html())).toEqual({
        cacheable: true,
        vary: "Cookie, Accept-Language",
        purge: false,
      });
    }
  });

  it("管理画面と API はキャッシュしない", () => {
    expect(decideCache(get("/admin/crawler-health"), html()).cacheable).toBe(false);
    expect(decideCache(get("/api/crawler-freshness"), json()).cacheable).toBe(false);
    expect(decideCache(get("/api/admin/known-ids"), json()).cacheable).toBe(false);
  });

  it("200 以外と、cookie を立てる応答はキャッシュしない", () => {
    expect(decideCache(get("/voice-actors/nobody"), html(404)).cacheable).toBe(false);
    expect(decideCache(get("/"), html(302)).cacheable).toBe(false);
    expect(decideCache(get("/"), html(200, { "set-cookie": "a=1" })).cacheable).toBe(false);
  });

  it("サーバー関数は、公開データを名乗ったものだけキャッシュする", () => {
    expect(
      decideCache(serverFn("/_serverFn/abc"), json({ [PUBLIC_DATA_HEADER]: "public" })),
    ).toEqual({ cacheable: true, purge: false });
    expect(decideCache(serverFn("/_serverFn/abc"), json()).cacheable).toBe(false);
  });

  /**
   * キャッシュのキーは URL だけ。ヘッダの無いリクエストへの応答 (直列化しない素の値) を載せると、
   * 同じ URL を引く画面に壊れた応答が返る
   */
  it("画面の取得でないサーバー関数の呼び出しへの応答はキャッシュしない", () => {
    const marked = json({ [PUBLIC_DATA_HEADER]: "public" });
    expect(decideCache(serverFn("/_serverFn/abc", {}), marked).cacheable).toBe(false);
  });

  it("sitemap と robots はキャッシュし、それ以外の HTML でないものはキャッシュしない", () => {
    expect(decideCache(get("/sitemap.xml"), new Response("<urlset/>")).cacheable).toBe(true);
    expect(decideCache(get("/robots.txt"), new Response("User-agent: *")).cacheable).toBe(true);
    expect(decideCache(get("/something.json"), json()).cacheable).toBe(false);
    // 言語 cookie で中身が変わるので、共有キャッシュには載せない
    expect(decideCache(get("/manifest.webmanifest"), json()).cacheable).toBe(false);
  });

  it("書き込みがデータを変えたと名乗って成功したら、キャッシュを消す", () => {
    expect(decideCache(post("/api/admin/ingest"), json(dataChangedHeaders(true)))).toEqual({
      cacheable: false,
      purge: true,
    });
    expect(decideCache(post("/api/admin/ingest"), json(dataChangedHeaders(true), 400)).purge).toBe(
      false,
    );
  });

  /** 取り込みの大半は既知の作品を取り込み直すだけ。そこで消すと、消す回数の上限をすぐに使い切る */
  it("何も変えなかった書き込みではキャッシュを消さない", () => {
    expect(decideCache(post("/api/admin/ingest"), json(dataChangedHeaders(false)))).toEqual({
      cacheable: false,
      purge: false,
    });
  });

  /**
   * 既存の行を書き換えただけの書き込み (発売日の補完、credit の解決) では、前のキャッシュは消さず
   * クエリ結果のキャッシュの世代だけ上げる。上げないと、前のキャッシュが寿命で入れ替わるときに古い結果から作り直す
   */
  it("既存の行を書き換えた書き込みでは、クエリ結果の世代だけを上げる", () => {
    const decision = decideCache(post("/api/admin/ingest"), json(dataChangedHeaders(false, true)));

    expect(decision).toEqual({ cacheable: false, purge: false, refresh: true });
    expect(
      applyCacheDecision(json(dataChangedHeaders(false, true)), decision).headers.has(
        DATA_CHANGED_HEADER,
      ),
    ).toBe(false);
  });

  /** POST でも読むだけの関数 (フォロー中のフィード) で消すと、消す回数の上限をすぐに使い切る */
  it("POST のサーバー関数は、書き換えたと名乗ったときだけキャッシュを消す", () => {
    expect(decideCache(post("/_serverFn/feed"), json()).purge).toBe(false);
    expect(decideCache(post("/_serverFn/assign"), json({ [DATA_CHANGED_HEADER]: "1" })).purge).toBe(
      true,
    );
  });
});

describe("applyCacheDecision", () => {
  it("キャッシュ可なら、寿命は Cloudflare にだけ渡し、ブラウザには no-cache を返す", () => {
    const response = applyCacheDecision(html(), {
      cacheable: true,
      vary: "Cookie, Accept-Language",
      purge: false,
    });

    expect(response.headers.get("cloudflare-cdn-cache-control")).toBe(CDN_CACHE_CONTROL);
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(response.headers.get("vary")).toBe("Cookie, Accept-Language");
  });

  it("応答がもともと持つ Vary は残して足す", () => {
    const response = applyCacheDecision(html(200, { vary: "Accept-Encoding" }), {
      cacheable: true,
      vary: "Cookie, Accept-Language",
      purge: false,
    });

    expect(response.headers.get("vary")).toBe("Accept-Encoding, Cookie, Accept-Language");
  });

  it("キャッシュ可でも、応答が自分で付けたブラウザ向けの指定は残す", () => {
    const response = applyCacheDecision(
      new Response("<urlset/>", { headers: { "cache-control": "public, max-age=3600" } }),
      { cacheable: true, purge: false },
    );

    expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(response.headers.get("cloudflare-cdn-cache-control")).toBe(CDN_CACHE_CONTROL);
  });

  it("キャッシュ不可なら no-store にし、関数が付けた寿命も外す", () => {
    const response = applyCacheDecision(
      json({ "cloudflare-cdn-cache-control": "max-age=60", "cache-control": "public" }),
      { cacheable: false, purge: false },
    );

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.has("cloudflare-cdn-cache-control")).toBe(false);
  });

  it("目印のヘッダは外に出さない", () => {
    const response = applyCacheDecision(
      json({ [PUBLIC_DATA_HEADER]: "public", [DATA_CHANGED_HEADER]: "1" }),
      { cacheable: true, purge: false },
    );

    expect(response.headers.has(PUBLIC_DATA_HEADER)).toBe(false);
    expect(response.headers.has(DATA_CHANGED_HEADER)).toBe(false);
  });

  it("キャッシュ不可でも、応答が private を名乗っていればブラウザ向けの指定を残す", () => {
    const response = applyCacheDecision(
      json({ "cache-control": "private, max-age=3600", vary: "Cookie" }),
      { cacheable: false, purge: false },
    );

    expect(response.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(response.headers.get("vary")).toBe("Cookie");
  });

  it("状態コードと本文はそのまま", async () => {
    const response = applyCacheDecision(html(404), { cacheable: false, purge: false });

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("<!doctype html>");
  });
});
