import { createFileRoute } from "@tanstack/react-router";
import { createTranslator } from "@/app/i18n";
import { contactSearch, contactTargetUrl, readContactSearch } from "@/app/lib/contact-search";
import { ContactPage } from "@/app/pages/contact";
import { fetchInquiryFormConfig } from "@/app/server-fns/inquiries";
import { fetchContactUrl, siteOriginForLoader } from "@/app/server-fns/site";

/** お問い合わせ。画面は `@/app/pages/contact` */
export const Route = createFileRoute("/contact")({
  /**
   * 種別と、訂正を申し出る対象のページ。作品ページ・声優ページのリンクが付ける。
   *
   * 読めない値と既定の種別は欄を返さない。ここで返した欄はルーターがハイドレーション時に
   * URL へ書き戻すので、既定値を返すと素の URL が `?kind=request` に化け、
   * head() が出す canonical (欄なし) と食い違う。
   * 親のルートは検索文字列を素通しするため、画面に渡す前に `RouteComponent` が読み直す
   */
  validateSearch: contactSearch,
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
  const { turnstileSiteKey, contactUrl, origin } = Route.useLoaderData();
  const { kind, about } = readContactSearch(Route.useSearch());

  return (
    <ContactPage
      turnstileSiteKey={turnstileSiteKey}
      contactUrl={contactUrl}
      defaultKind={kind}
      targetUrl={contactTargetUrl(origin, about)}
    />
  );
}
