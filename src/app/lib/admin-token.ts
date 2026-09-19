/**
 * 管理画面を `?token=xxx` で開けるようにする処理。
 *
 * 画面遷移では Authorization ヘッダを付けられないので、URL で渡されたトークンを
 * HttpOnly cookie に移し、トークンを落とした同じパスへ送り直す。
 * URL にトークンが残り続けると、履歴・Referer・共有リンクから漏れるため
 */

/**
 * `?token=` があれば処理して Response を返す。無ければ undefined を返して次の処理に渡す。
 *
 * - `ADMIN_TOKEN` と一致したときだけ cookie を立てる。一致しない値をそのまま cookie に
 *   入れると、外から渡したリンクで任意の値を仕込める (それ自体では管理画面に入れないが、
 *   正しい cookie を上書きして追い出せてしまう)
 * - `token=` が空なら cookie を消す。管理者がその端末からログアウトする手段
 * - 一致しなかった場合は cookie を触らず、トークンを落とした同じパスへ送り直すだけにする。
 *   「一致しなかった」ことを応答の形で区別させない
 */
export async function handleAdminTokenQuery(request: Request): Promise<Response | undefined> {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (token === null) return undefined;

  // `@/server/**` はサーバー専用。server route の中で動的に読み込み、
  // クライアントのバンドルに入れない (server function と同じ方針)
  const [{ adminCookie, clearAdminCookie, isAdminToken }, { env }] = await Promise.all([
    import("@/server/auth"),
    import("cloudflare:workers"),
  ]);

  url.searchParams.delete("token");
  const location = `${url.pathname}${url.search}`;

  const setCookie =
    token === "" ? clearAdminCookie() : isAdminToken(token, env) ? adminCookie(token) : undefined;

  return new Response(null, {
    // 303 にして、戻るボタンでトークン付き URL に戻らないようにする
    status: 303,
    headers: {
      Location: location,
      ...(setCookie ? { "set-cookie": setCookie } : {}),
    },
  });
}
