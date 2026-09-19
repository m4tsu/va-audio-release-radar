/**
 * 認可のヘルパー。秘匿値そのものは受け取る側から渡してもらい、
 * このファイルは `cloudflare:workers` に依存しない (単体テストから素の Request で呼べるようにする)
 */

/** 管理画面のトークンを載せる cookie 名。`/admin/*?token=` から立てる */
export const ADMIN_COOKIE_NAME = "admin_token";

/** cookie の寿命。管理者が手で入れ直す手間と、端末を離れたときの露出のバランスで 30 日 */
const ADMIN_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * Bearer トークンを検証し、通らなければ返すべき Response を、通れば null を返す。
 *
 * `expected` が未設定 (secret を置いていない) なら 401 ではなく 503 にする。
 * 「トークンが違う」のか「サーバー側でまだ設定していない」のかを運用時に切り分けるため
 */
export function requireBearer(request: Request, expected: string | undefined): Response | null {
  if (!expected) {
    return Response.json(
      { error: "この機能のトークンがサーバーに設定されていない" },
      { status: 503 },
    );
  }

  const header = request.headers.get("authorization") ?? "";
  if (!isBearerMatch(header, expected)) {
    return Response.json({ error: "Bearer トークンが不正" }, { status: 401 });
  }

  return null;
}

/**
 * 管理画面用の判定。`Authorization: Bearer` か cookie のどちらかが一致すれば true。
 * 画面遷移では Authorization ヘッダを送れないので cookie を併用する
 */
export function isAdminRequest(request: Request, env: { ADMIN_TOKEN?: string }): boolean {
  const expected = env.ADMIN_TOKEN;
  if (!expected) return false;

  const header = request.headers.get("authorization") ?? "";
  if (isBearerMatch(header, expected)) return true;

  const cookie = readCookie(request, ADMIN_COOKIE_NAME);
  return cookie !== undefined && timingSafeEqual(cookie, expected);
}

/**
 * 管理画面の cookie を立てる `Set-Cookie` の値を作る。
 *
 * Path は `/admin` ではなく `/` にしている。TanStack Start の server function は
 * `/_serverFn/...` へ POST するため、`/admin` に絞ると管理画面が呼ぶ server function に
 * cookie が付かず 401 になる。HttpOnly なので JS からは読めない
 */
export function adminCookie(token: string): string {
  return [
    `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${ADMIN_COOKIE_MAX_AGE_SECONDS}`,
  ].join("; ");
}

/** ログアウト用。Max-Age=0 で同じ cookie を消す */
export function clearAdminCookie(): string {
  return [
    `${ADMIN_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=0",
  ].join("; ");
}

function isBearerMatch(authorizationHeader: string, expected: string): boolean {
  const prefix = "Bearer ";
  if (!authorizationHeader.startsWith(prefix)) return false;
  return timingSafeEqual(authorizationHeader.slice(prefix.length), expected);
}

/**
 * 文字列比較にかかる時間を入力内容に依存させない。
 * `===` は先頭から違う位置で打ち切るため、総当たりに手がかりを与えうる。
 *
 * 長さが違うときも即 return しない。早期 return すると「長さが合っているか」だけは
 * 応答時間から読み取れてしまい、総当たりの探索空間を先に絞られる。
 * 長い方に合わせて最後まで回し、長さの一致は最後に AND で畳む
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) {
    // 範囲外は undefined になるので 0 として扱う。短い側でも反復回数は変わらない
    diff |= (a.codePointAt(i) ?? 0) ^ (b.codePointAt(i) ?? 0);
  }
  return diff === 0;
}

/**
 * `?token=` に入っていた値が管理者トークンと一致するか。
 * `ADMIN_TOKEN` が未設定なら、何を渡されても一致しない (cookie も立てない)
 */
export function isAdminToken(token: string, env: { ADMIN_TOKEN?: string }): boolean {
  const expected = env.ADMIN_TOKEN;
  if (!expected) return false;
  return timingSafeEqual(token, expected);
}

/** Cookie ヘッダから 1 つ取り出す。Workers には cookie パーサが無いので自前で分解する */
function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return undefined;
}
