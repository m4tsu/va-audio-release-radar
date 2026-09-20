import { createFileRoute } from "@tanstack/react-router";
import { ADMIN_HEAD_META } from "@/app/components/admin-gate";
import { createTranslator } from "@/app/i18n";
import { handleAdminTokenQuery } from "@/app/lib/admin-token";
import { UnmatchedCreditsPage } from "@/app/pages/admin/unmatched-credits";
import { fetchAllActors } from "@/app/server-fns/actors";
import { fetchUnmatchedCredits } from "@/app/server-fns/admin";
import { fetchAdminSession } from "@/app/server-fns/admin-session";

/**
 * 1 度に出す未解決の表記の数。
 *
 * かつては D1 の bound parameter 上限 (100) を避けるため 50 に絞っていた。
 * `listUnmatchedCredits` が表記名を 1 つの IN 句に並べていたためで、
 * 表記 100 件 + confidence の 1 件で上限を超えていた。
 * いまは `src/server/queries/admin.ts` が `chunked()` で IN 句を 90 件ずつに切るので、
 * この定数は「1 画面に何件出すか」だけの話に戻っている
 */
const GROUPS_PER_PAGE = 100;

/** 未解決クレジットの割り当て。画面は `@/app/pages/admin/unmatched-credits` */
export const Route = createFileRoute("/admin/unmatched-credits")({
  server: {
    handlers: {
      GET: async ({ request, next }) => (await handleAdminTokenQuery(request)) ?? next(),
    },
  },
  loader: async () => {
    const session = await fetchAdminSession();
    if (!session.authorized) return { authorized: false as const, configured: session.configured };

    const [groups, actors] = await Promise.all([
      fetchUnmatchedCredits({ data: { limit: GROUPS_PER_PAGE } }),
      fetchAllActors(),
    ]);
    return { authorized: true as const, groups, actors };
  },
  head: ({ match }) => ({
    meta: [
      { title: createTranslator(match.context.locale)("admin.unmatchedMetaTitle") },
      ...ADMIN_HEAD_META,
    ],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return <UnmatchedCreditsPage {...Route.useLoaderData()} />;
}
