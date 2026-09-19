import { createFileRoute } from "@tanstack/react-router";
import { LegalDocumentView } from "@/app/components/legal-document";
import { createTranslator, useLocale, useT } from "@/app/i18n";
import { terms } from "@/app/legal/terms";
import { fetchContactUrl, siteOriginForLoader } from "@/app/server-fns/site";

/** 利用規約。本文は `src/app/legal/terms.ts` */
export const Route = createFileRoute("/terms")({
  loader: async () => {
    const [contactUrl, origin] = await Promise.all([fetchContactUrl(), siteOriginForLoader()]);
    return { contactUrl, origin };
  },
  head: ({ loaderData, match }) => {
    const t = createTranslator(match.context.locale);
    const app = t("app.name");
    const title = t("legal.termsMetaTitle", { app });
    const description = t("legal.termsMetaDescription", { app });
    const canonical = loaderData ? `${loaderData.origin}/terms` : "/terms";
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
  component: TermsPage,
});

function TermsPage() {
  const t = useT();
  const locale = useLocale();
  const { contactUrl } = Route.useLoaderData();
  return (
    <LegalDocumentView
      title={t("legal.termsTitle")}
      document={terms[locale]}
      contactUrl={contactUrl}
    />
  );
}
