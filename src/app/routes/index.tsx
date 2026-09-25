import { createFileRoute } from "@tanstack/react-router";
import { createTranslator } from "@/app/i18n";
import { siteImageMeta } from "@/app/lib/site-image";
import { HomePage } from "@/app/pages/home";
import { siteOriginForLoader } from "@/app/server-fns/site";
import { fetchLatestWorks } from "@/app/server-fns/works";
import { STORE_SLUGS } from "@/domain/types";

/** トップに出す新着の範囲。ストアごとに引くので、1 ストアあたりの件数で考える */
const LATEST_SINCE_DAYS = 30;
const LATEST_LIMIT = 12;

/** トップ。画面は `@/app/pages/home` */
export const Route = createFileRoute("/")({
  loader: async () => {
    // ストアごとに引くのは、同じ数だけ並べても 1 ストアの発売予定で埋まってしまうため。
    // 3 ストアぶんをまとめて渡し、タブの切り替えでは取り直さない
    const [latestByStore, origin] = await Promise.all([
      Promise.all(
        STORE_SLUGS.map(async (storeSlug) => ({
          storeSlug,
          items: await fetchLatestWorks({
            data: { sinceDays: LATEST_SINCE_DAYS, limit: LATEST_LIMIT, storeSlug },
          }),
        })),
      ),
      siteOriginForLoader(),
    ]);
    return { latestByStore, origin };
  },
  head: ({ loaderData, match }) => {
    const t = createTranslator(match.context.locale);
    const app = t("app.name");
    const title = t("home.metaTitle", { app });
    const description = t("app.description");
    const canonical = loaderData ? `${loaderData.origin}/` : "/";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:url", content: canonical },
        ...(loaderData ? siteImageMeta(loaderData.origin) : []),
      ],
      links: [{ rel: "canonical", href: canonical }],
    };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { latestByStore } = Route.useLoaderData();
  return <HomePage latestByStore={latestByStore} />;
}
