import { InquiryForm } from "@/app/components/inquiry-form";
import { PageHeader } from "@/app/components/page-header";
import { useT } from "@/app/i18n";
import { contactLinkLabel } from "@/app/lib/format";

/**
 * お問い合わせ。入力と送信は `@/app/components/inquiry-form` が持つ。
 *
 * `turnstileSiteKey` が null なのは bot 対策の鍵が片方でも欠けている環境。
 * 入力欄は描いたまま、送れないことと代わりの窓口を先に出す
 */
export function ContactPage({
  turnstileSiteKey,
  contactUrl,
}: {
  turnstileSiteKey: string | null;
  /** `CONTACT_URL`。送れないときの代わりの窓口。無ければ案内を出さない */
  contactUrl: string | null;
}) {
  const t = useT();

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t("contact.title")} description={t("contact.intro")} />

      {turnstileSiteKey === null ? (
        <p className="mb-6 rounded-md border border-destructive/50 px-3 py-2 text-sm">
          {t("contact.unavailable")}
          {contactUrl ? (
            <>
              {" "}
              {t("contact.unavailableAlternative")}{" "}
              <a href={contactUrl} className="break-all underline underline-offset-2">
                {contactLinkLabel(contactUrl)}
              </a>
            </>
          ) : null}
        </p>
      ) : null}

      <InquiryForm turnstileSiteKey={turnstileSiteKey} />
    </div>
  );
}
