import { LegalDocumentView } from "@/app/components/legal-document";
import { useLocale, useT } from "@/app/i18n";
import { terms } from "@/app/legal/terms";

/** 利用規約。本文は `src/app/legal/terms.ts` */
export function TermsPage({ contactUrl }: { contactUrl: string | null }) {
  const t = useT();
  const locale = useLocale();
  return (
    <LegalDocumentView
      title={t("legal.termsTitle")}
      document={terms[locale]}
      contactUrl={contactUrl}
    />
  );
}
