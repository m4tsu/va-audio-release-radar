import { INQUIRY_KINDS, type InquiryKind } from "@/domain/types";

/**
 * お問い合わせ画面 (`/contact`) の検索文字列。
 *
 * 作品ページと声優ページの「掲載内容の誤りを知らせる」から開いたときに、種別と対象のページを
 * URL で渡すためにある。渡さないと申し出る人が対象の URL を自分で書き写すことになる。
 *
 * `about` はこのサイトの中のパスだけを受ける。URL をまるごと受けると、他所を指すリンクを
 * 作って本文の先頭に好きな文字列を仕込めてしまう。オリジンは画面側が付ける
 * (`contactTargetUrl`)
 */

/** 欄が無い / 読めないときの種別。`/contact` を直接開いたときはこれが選ばれている */
export const DEFAULT_INQUIRY_KIND: InquiryKind = "request";

/** URL に載せる欄。読めなかった欄と既定の種別は落とす */
export type ContactSearch = { kind?: InquiryKind; about?: string };

/** 画面が使う形。`about` は読めなければ null */
export type ContactTarget = { kind: InquiryKind; about: string | null };

export function isInquiryKind(value: unknown): value is InquiryKind {
  return typeof value === "string" && (INQUIRY_KINDS as readonly string[]).includes(value);
}

/**
 * このサイトの中のパスか。
 *
 * 先頭が `/` でも `//example.com` は別オリジンの URL として解釈される。
 * `\` を混ぜた `/\example.com` も同じなので、2 文字目で弾く
 */
function isInternalPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.startsWith("/\\")
  );
}

/**
 * URL の検索文字列を画面に渡す形に直す。読めない値は指定が無かったものとして扱う。
 * 共有されたリンクの欄が 1 つ壊れているだけで画面が出せなくなると、リンクが壊れて見える
 */
export function readContactSearch(search: { kind?: unknown; about?: unknown }): ContactTarget {
  return {
    kind: isInquiryKind(search.kind) ? search.kind : DEFAULT_INQUIRY_KIND,
    about: isInternalPath(search.about) ? search.about : null,
  };
}

/**
 * URL に載せる欄。既定の種別と読めない値は欄ごと落とす。
 *
 * 載せると、ルーターがハイドレーション時に素の `/contact` を `?kind=request` に書き換え、
 * head() が出す canonical (欄なし) と食い違う
 */
export function contactSearch(search: { kind?: unknown; about?: unknown }): ContactSearch {
  const target = readContactSearch(search);
  return {
    ...(target.kind === DEFAULT_INQUIRY_KIND ? {} : { kind: target.kind }),
    ...(target.about === null ? {} : { about: target.about }),
  };
}

/**
 * 本文の先頭に入れる、対象のページの URL。
 * オリジンが取れていなければパスのまま出す (`routes/works.$id.tsx` の canonical と同じ扱い)
 */
export function contactTargetUrl(origin: string | undefined, about: string | null): string | null {
  if (about === null) return null;
  return origin ? `${origin}${about}` : about;
}
