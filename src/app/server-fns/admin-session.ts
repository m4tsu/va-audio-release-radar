import { createServerFn } from "@tanstack/react-start";

/**
 * 管理画面が「トークンが通っているか」だけを先に確かめるための server function。
 *
 * `server-fns/admin.ts` の各関数は認可に失敗すると 401 の Response を throw する。
 * それを画面のローダーでそのまま受けるとページ全体が 401 になってしまうので、
 * 先にここで判定して「管理者トークンが必要です」を描けるようにする
 */
export const fetchAdminSession = createServerFn({ method: "GET" }).handler(async () => {
  const [{ getRequest }, { env }, { isAdminRequest }] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("cloudflare:workers"),
    import("@/server/auth"),
  ]);

  return {
    authorized: isAdminRequest(getRequest(), env),
    /** サーバーに ADMIN_TOKEN 自体が無い場合。トークン違いと運用上で切り分ける */
    configured: Boolean(env.ADMIN_TOKEN),
  };
});
