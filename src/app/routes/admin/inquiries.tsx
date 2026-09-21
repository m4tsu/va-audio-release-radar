import { createFileRoute } from "@tanstack/react-router";
import { ADMIN_HEAD_META } from "@/app/components/admin-gate";
import { createTranslator } from "@/app/i18n";
import { handleAdminTokenQuery } from "@/app/lib/admin-token";
import { AdminInquiriesPage } from "@/app/pages/admin/inquiries";
import { fetchInquiries } from "@/app/server-fns/admin";
import { fetchAdminSession } from "@/app/server-fns/admin-session";

/** 1 ページに出す問い合わせの件数。これより多ければ続きは次のページに回る */
const INQUIRIES_PER_PAGE = 50;

/** 届いた問い合わせの一覧。画面は `@/app/pages/admin/inquiries` */
export const Route = createFileRoute("/admin/inquiries")({
  server: {
    handlers: {
      GET: async ({ request, next }) => (await handleAdminTokenQuery(request)) ?? next(),
    },
  },
  /**
   * 何ページ目か。1 ページ目では欄を返さない。ここで返した欄はルーターが
   * ハイドレーション時に URL へ書き戻すので、既定値を返すと素の URL が `?page=1` に化ける
   */
  validateSearch: (search: Record<string, unknown>): { page?: number } => {
    const page = Number(search.page);
    if (!Number.isInteger(page) || page < 2) return {};
    return { page };
  },
  loaderDeps: ({ search }) => ({ page: search.page ?? 1 }),
  loader: async ({ deps }) => {
    const session = await fetchAdminSession();
    if (!session.authorized) return { authorized: false as const, configured: session.configured };

    // 続きがあるかを別の COUNT で数えず、1 件多く引いて余りの有無で判定する
    const rows = await fetchInquiries({
      data: { limit: INQUIRIES_PER_PAGE + 1, offset: (deps.page - 1) * INQUIRIES_PER_PAGE },
    });

    return {
      authorized: true as const,
      page: deps.page,
      inquiries: rows.slice(0, INQUIRIES_PER_PAGE),
      hasNext: rows.length > INQUIRIES_PER_PAGE,
    };
  },
  head: ({ match }) => ({
    meta: [
      { title: createTranslator(match.context.locale)("admin.inquiriesMetaTitle") },
      ...ADMIN_HEAD_META,
    ],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return <AdminInquiriesPage {...Route.useLoaderData()} />;
}
