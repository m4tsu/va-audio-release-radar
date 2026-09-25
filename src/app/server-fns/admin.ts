import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { STORE_SLUGS } from "@/domain/types";

/**
 * 管理画面 (/admin/*) 用の server function。
 *
 * 画面のルート側でも認可するが、server function は直接叩ける独立したエンドポイントなので
 * ここでも必ず検証する。画面遷移では Authorization ヘッダを付けられないため、
 * 実際に通るのは cookie 経路になる (`@/server/auth` の adminCookie)
 */

/** 認可に失敗したら Response を throw する。Start は throw された Response をそのまま返す */
async function requireAdmin(): Promise<void> {
  const [{ getRequest }, { env }, { isAdminRequest }] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("cloudflare:workers"),
    import("@/server/auth"),
  ]);

  if (!isAdminRequest(getRequest(), env)) {
    throw new Response("管理者トークンが一致しない", { status: 401 });
  }
}

/** 既定値はスキーマと「引数なしで呼べる」ための default の両方で使うので定数にする */
const UNMATCHED_DEFAULTS = { limit: 100 };
const unmatchedLimitSchema = z.object({
  limit: z.number().int().min(1).max(500).default(UNMATCHED_DEFAULTS.limit),
});

export const fetchUnmatchedCredits = createServerFn({ method: "GET" })
  .validator(unmatchedLimitSchema.default(UNMATCHED_DEFAULTS))
  .handler(async ({ data }) => {
    await requireAdmin();
    const [{ getDb }, { listUnmatchedCredits }] = await Promise.all([
      import("@/server/db/client"),
      import("@/server/queries/admin"),
    ]);
    return listUnmatchedCredits(getDb(), data.limit);
  });

export const assignCreditFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      creditedName: z.string().min(1),
      sourceStoreSlug: z.enum(STORE_SLUGS),
      voiceActorId: z.string().min(1),
      addAlias: z.boolean().default(true),
    }),
  )
  .handler(async ({ data }) => {
    await requireAdmin();
    const [{ getDb }, { assignCredit }, { markDataChanged }] = await Promise.all([
      import("@/server/db/client"),
      import("@/server/queries/admin"),
      import("@/server/response-cache"),
    ]);
    const result = await assignCredit(getDb(), data);
    markDataChanged();
    return result;
  });

/** 対象外の印は名前 × ストアで付く。付けるのも外すのも同じ組で指す */
const creditNameSchema = z.object({
  creditedName: z.string().min(1),
  sourceStoreSlug: z.enum(STORE_SLUGS),
});

/**
 * 印は管理画面の未解決キューにしか効かない。公開画面が読む credit は変わらないので、
 * 割り当てと違って応答キャッシュを捨てない
 */
export const excludeCreditNameFn = createServerFn({ method: "POST" })
  .validator(creditNameSchema)
  .handler(async ({ data }) => {
    await requireAdmin();
    const [{ getDb }, { excludeCreditName }] = await Promise.all([
      import("@/server/db/client"),
      import("@/server/queries/admin"),
    ]);
    await excludeCreditName(getDb(), data);
  });

export const unexcludeCreditNameFn = createServerFn({ method: "POST" })
  .validator(creditNameSchema)
  .handler(async ({ data }) => {
    await requireAdmin();
    const [{ getDb }, { unexcludeCreditName }] = await Promise.all([
      import("@/server/db/client"),
      import("@/server/queries/admin"),
    ]);
    await unexcludeCreditName(getDb(), data);
  });

export const fetchExcludedCreditNames = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const [{ getDb }, { listExcludedCreditNames }] = await Promise.all([
    import("@/server/db/client"),
    import("@/server/queries/admin"),
  ]);
  return listExcludedCreditNames(getDb());
});

export const fetchCrawlerHealth = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const [{ getDb }, { crawlerHealth }] = await Promise.all([
    import("@/server/db/client"),
    import("@/server/queries/admin"),
  ]);
  return crawlerHealth(getDb());
});

/**
 * 届いた問い合わせの読み出し。飛ばす件数まで受け取るので、画面は 1 ページぶんずつ辿れる。
 * 上限は 1 度に読む件数の歯止め。管理画面が出す件数より大きく取ってあるのは、
 * 「次のページがあるか」を数えるために 1 件多く引くため
 */
const INQUIRY_DEFAULTS = { limit: 50, offset: 0 };
const inquiryPageSchema = z.object({
  limit: z.number().int().min(1).max(200).default(INQUIRY_DEFAULTS.limit),
  offset: z.number().int().min(0).default(INQUIRY_DEFAULTS.offset),
});

export const fetchInquiries = createServerFn({ method: "GET" })
  .validator(inquiryPageSchema.default(INQUIRY_DEFAULTS))
  .handler(async ({ data }) => {
    await requireAdmin();
    const [{ getDb }, { listInquiries }] = await Promise.all([
      import("@/server/db/client"),
      import("@/server/queries/inquiries"),
    ]);
    return listInquiries(getDb(), data.limit, data.offset);
  });
