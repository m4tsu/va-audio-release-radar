import { createFileRoute } from "@tanstack/react-router";
import { ADMIN_HEAD_META } from "@/app/components/admin-gate";
import { createTranslator } from "@/app/i18n";
import { handleAdminTokenQuery } from "@/app/lib/admin-token";
import { CrawlerHealthPage } from "@/app/pages/admin/crawler-health";
import { fetchCrawlerHealth } from "@/app/server-fns/admin";
import { fetchAdminSession } from "@/app/server-fns/admin-session";

/** クローラー健全性。画面は `@/app/pages/admin/crawler-health` */
export const Route = createFileRoute("/admin/crawler-health")({
  server: {
    handlers: {
      GET: async ({ request, next }) => (await handleAdminTokenQuery(request)) ?? next(),
    },
  },
  loader: async () => {
    const session = await fetchAdminSession();
    if (!session.authorized) return { authorized: false as const, configured: session.configured };
    return { authorized: true as const, health: await fetchCrawlerHealth() };
  },
  head: ({ match }) => ({
    meta: [
      { title: createTranslator(match.context.locale)("admin.healthMetaTitle") },
      ...ADMIN_HEAD_META,
    ],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return <CrawlerHealthPage {...Route.useLoaderData()} />;
}
