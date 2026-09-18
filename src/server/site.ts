import { env } from "cloudflare:workers";
import { getRequest } from "@tanstack/react-start/server";

/**
 * 公開 URL のオリジンを決める (R1 の指摘: canonical が相対パスだった)。
 *
 * canonical / og:url / sitemap / robots の Sitemap 行は絶対 URL でなければ意味が薄い。
 * ただしホストはデプロイ先 (本番 / プレビュー / ローカル) で変わるため定数には置けない。
 *
 * 優先順位:
 * 1. `env.SITE_URL` (wrangler.jsonc の `vars`)。本番で正規のホストに固定するためのもの。
 *    カスタムドメインに寄せたい / プレビュー URL を canonical にしたくない場合はここを設定する
 * 2. 実際に来たリクエストのオリジン。未設定でもローカルと preview が破綻しないようにする
 *
 * このファイルはサーバー専用 (`src/server/**` は importProtection でクライアントから読めない)。
 * `head()` は SSR とクライアントの両方で動くので、オリジンはローダー側で解決し、
 * loaderData に載せて `head()` へ渡すこと
 */

/** 末尾のスラッシュを落としたオリジン (例 "https://example.com") */
export function siteOrigin(request?: Request): string {
  const configured = normalizeOrigin(env.SITE_URL);
  if (configured) return configured;
  return new URL((request ?? getRequest()).url).origin;
}

/** オリジンとパスを繋いだ絶対 URL。`path` は "/" 始まりで渡す */
export function siteUrl(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, "")}${path}`;
}

/**
 * `SITE_URL` は空文字を既定値として wrangler.jsonc の `vars` に置いてある。
 * 空文字・空白だけ・URL として解釈できない値は「未設定」とみなしてリクエスト側に倒す
 */
function normalizeOrigin(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  try {
    return new URL(trimmed).origin;
  } catch {
    return undefined;
  }
}
