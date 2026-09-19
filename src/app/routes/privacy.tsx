import { createFileRoute } from "@tanstack/react-router";
import { LegalDocumentView } from "@/app/components/legal-document";
import { createTranslator, useLocale, useT } from "@/app/i18n";
import { privacy } from "@/app/legal/privacy";
import { fetchContactUrl, siteOriginForLoader } from "@/app/server-fns/site";

/** プライバシーポリシー。本文は `src/app/legal/privacy.ts` */
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
      ],
      links: [{ rel: "canonical", href: canonical }],
    };
  },
  component: PrivacyPage,
});

function PrivacyPage() {
  const t = useT();
  const locale = useLocale();
  const { contactUrl } = Route.useLoaderData();
  return (
    <LegalDocumentView
      title={t("legal.privacyTitle")}
      document={privacy[locale]}
      contactUrl={contactUrl}
    />
  );
}
