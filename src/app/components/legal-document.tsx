import { PageHeader } from "@/app/components/page-header";
import { useLocale, useT } from "@/app/i18n";
import type { LegalBlock, LegalDocument } from "@/app/legal";
import { formatReleaseDate } from "@/app/lib/format";

/**
 * 利用規約とプライバシーポリシーの共通の描画。
 * 本文は `src/app/legal/` の言語別データで、ここは条の並びをそのまま h2 と段落にする
 */
export function LegalDocumentView({
  title,
  document,
  contactUrl,
}: {
  title: string;
  document: LegalDocument;
  /** `CONTACT_URL`。無ければ窓口の案内を出さない */
  contactUrl: string | null;
}) {
  const t = useT();
  const locale = useLocale();

  return (
    <article className="mx-auto max-w-3xl">
      <PageHeader
        title={title}
        description={t("legal.effectiveDate", {
          date: formatReleaseDate(document.effectiveDate, locale),
        })}
      />
      <div className="space-y-8 text-sm leading-relaxed">
        {document.sections.map((section) => (
          <section key={section.id} id={section.id} className="space-y-3">
            <h2 className="font-semibold text-base">{section.heading}</h2>
            {section.blocks.map((block, index) => (
              // 静的な文書で並び替えが起きないので index を key にしてよい
              <Block key={index} block={block} contactUrl={contactUrl} />
            ))}
          </section>
        ))}
      </div>
    </article>
  );
}

function Block({ block, contactUrl }: { block: LegalBlock; contactUrl: string | null }) {
  switch (block.type) {
    case "paragraph":
      return <p>{block.text}</p>;
    case "list":
      return (
        <ul className="list-disc space-y-1 pl-6">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    case "contact":
      if (!contactUrl) return <p>{block.withoutUrl}</p>;
      return (
        <p>
          {block.withUrl}{" "}
          <a href={contactUrl} className="break-all underline underline-offset-2">
            {contactLabel(contactUrl)}
          </a>
        </p>
      );
  }
}

/** `mailto:` はアドレスだけを見せる。URL はそのまま */
function contactLabel(url: string): string {
  return url.startsWith("mailto:") ? url.slice("mailto:".length) : url;
}
