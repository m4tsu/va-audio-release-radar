import { InquiryForm } from "@/app/components/inquiry-form";
import { PageHeader } from "@/app/components/page-header";
import { useT } from "@/app/i18n";
import { DEFAULT_INQUIRY_KIND } from "@/app/lib/contact-search";
import { contactLinkLabel } from "@/app/lib/format";
import type { InquiryKind } from "@/domain/types";

/**
 * お問い合わせ。入力と送信は `@/app/components/inquiry-form` が持つ。
 *
 * `turnstileSiteKey` が null なのは bot 対策の鍵が片方でも欠けている環境。
 * 入力欄は描いたまま、送れないことと代わりの窓口を先に出す。
 *
 * 種別と対象のページは URL から来る (`@/app/lib/contact-search`)。作品ページ・声優ページの
 * 「掲載内容の誤りを知らせる」から開いたときだけ既定と違う値が入る
 */
export function ContactPage({
  turnstileSiteKey,
  contactUrl,
  defaultKind = DEFAULT_INQUIRY_KIND,
  targetUrl = null,
}: {
  turnstileSiteKey: string | null;
  /** `CONTACT_URL`。送れないときの代わりの窓口。無ければ案内を出さない */
  contactUrl: string | null;
  /** 最初に選ばれている種別 */
  defaultKind?: InquiryKind;
  /** 申し出の対象のページの URL。無ければ本文は空で始まる */
  targetUrl?: string | null;
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

      <InquiryForm
        turnstileSiteKey={turnstileSiteKey}
        defaultKind={defaultKind}
        targetUrl={targetUrl}
      />
    </div>
  );
}
