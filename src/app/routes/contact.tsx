import { createFileRoute } from "@tanstack/react-router";
import { createTranslator } from "@/app/i18n";
import { ContactPage } from "@/app/pages/contact";
import { fetchInquiryFormConfig } from "@/app/server-fns/inquiries";
import { fetchContactUrl, siteOriginForLoader } from "@/app/server-fns/site";

/** お問い合わせ。画面は `@/app/pages/contact` */
export const Route = createFileRoute("/contact")({
  loader: async () => {
    const [config, contactUrl, origin] = await Promise.all([
      fetchInquiryFormConfig(),
      fetchContactUrl(),
      siteOriginForLoader(),
    ]);
    return { turnstileSiteKey: config.turnstileSiteKey, contactUrl, origin };
  },
  head: ({ loaderData, match }) => {
    const t = createTranslator(match.context.locale);
    const app = t("app.name");
    const title = t("contact.metaTitle", { app });
    const description = t("contact.metaDescription", { app });
    const canonical = loaderData ? `${loaderData.origin}/contact` : "/contact";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:url", content: canonical },
      ],
      links: [{ rel: "canonical", href: canonical }],
    };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { turnstileSiteKey, contactUrl } = Route.useLoaderData();
  return <ContactPage turnstileSiteKey={turnstileSiteKey} contactUrl={contactUrl} />;
}
