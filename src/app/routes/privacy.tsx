import { createFileRoute } from "@tanstack/react-router";
import { createTranslator } from "@/app/i18n";
import { siteImageMeta } from "@/app/lib/site-image";
import { PrivacyPage } from "@/app/pages/privacy";
import { fetchContactUrl, siteOriginForLoader } from "@/app/server-fns/site";

/** プライバシーポリシー。画面は `@/app/pages/privacy` */
export const Route = createFileRoute("/privacy")({
  loader: async () => {
    const [contactUrl, origin] = await Promise.all([fetchContactUrl(), siteOriginForLoader()]);
    return { contactUrl, origin };
  },
  head: ({ loaderData, match }) => {
    const t = createTranslator(match.context.locale);
    const app = t("app.name");
    const title = t("legal.privacyMetaTitle", { app });
    const description = t("legal.privacyMetaDescription", { app });
    const canonical = loaderData ? `${loaderData.origin}/privacy` : "/privacy";
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
  const { contactUrl } = Route.useLoaderData();
  return <PrivacyPage contactUrl={contactUrl} />;
}
