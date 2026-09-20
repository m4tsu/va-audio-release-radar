import { LegalDocumentView } from "@/app/components/legal-document";
import { useLocale, useT } from "@/app/i18n";
import { privacy } from "@/app/legal/privacy";

/** プライバシーポリシー。本文は `src/app/legal/privacy.ts` */
export function PrivacyPage({ contactUrl }: { contactUrl: string | null }) {
  const t = useT();
  const locale = useLocale();
  return (
    <LegalDocumentView
      title={t("legal.privacyTitle")}
      document={privacy[locale]}
      contactUrl={contactUrl}
    />
  );
}
