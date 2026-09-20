import { createFileRoute, notFound } from "@tanstack/react-router";
import { storeLabel } from "@/app/components/store-badge";
import { createTranslator, type Locale } from "@/app/i18n";
import { dedupeCredits } from "@/app/lib/dedupe-credits";
import { categoryLabel } from "@/app/lib/format";
import { safeHttpsUrl } from "@/app/lib/safe-url";
import type { WorkDetail } from "@/app/lib/view-types";
import { WorkPage } from "@/app/pages/work";
import { siteOriginForLoader } from "@/app/server-fns/site";
import { fetchWork } from "@/app/server-fns/works";

/**
 * 作品ページ。画面は `@/app/pages/work`。
 *
 * `$id` は "dlsite:RJ01698658" の形。コロンを含むので sitemap は "%3A" に符号化して出す。
 * ルーターはパスパラメータを復号して渡すが、経路によっては符号化されたまま来るため念のため復号する
 */
export const Route = createFileRoute("/works/$id")({
  loader: async ({ params }) => {
    // canonical を絶対 URL にするためのオリジン。head() からは読めないのでここで解決する
    const [detail, origin] = await Promise.all([
      fetchWork({ data: { id: decodeWorkId(params.id) } }),
      siteOriginForLoader(),
    ]);
    if (!detail) throw notFound();
    return { detail, origin };
  },
  head: ({ loaderData, match }) => {
    if (!loaderData) return {};
    const { detail, origin } = loaderData;
    const locale = match.context.locale;
    const title = pageTitle(detail, locale);
    const description = pageDescription(detail, locale);
    // 作品 ID は "dlsite:RJ01698658" のようにコロンを含むので符号化してから並べる
    const path = `/works/${encodeURIComponent(detail.work.id)}`;
    const canonical = origin ? `${origin}${path}` : path;
    const cover = safeHttpsUrl(detail.work.coverImageUrl);

    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: canonical },
        ...(cover ? [{ property: "og:image", content: cover }] : []),
      ],
      links: [{ rel: "canonical", href: canonical }],
    };
  },
  component: RouteComponent,
});

/** "%3A" のまま来た場合だけ戻す。作品 ID に "%" は現れないので二重復号にならない */
function decodeWorkId(raw: string): string {
  return raw.includes("%") ? decodeURIComponent(raw) : raw;
}

function storeList(detail: WorkDetail, locale: Locale): string {
  const separator = createTranslator(locale)("common.listSeparator");
  return detail.listings.map((listing) => storeLabel(listing.storeSlug)).join(separator);
}

/** 作品名もストア名もデータそのもの。訳さずに並べ方だけを言語に合わせる */
function pageTitle(detail: WorkDetail, locale: Locale): string {
  const stores = storeList(detail, locale);
  return stores ? `${detail.work.title} | ${stores}` : detail.work.title;
}

function pageDescription(detail: WorkDetail, locale: Locale): string {
  const t = createTranslator(locale);
  // 表記違いによる重複を description にも出さないよう、本文と同じ dedupeCredits を通す
  const names = dedupeCredits(detail.credits).map(
    (credit) => credit.voiceActorName ?? credit.creditedName,
  );
  const cast =
    names.length > 0
      ? t("work.metaCast", { names: names.slice(0, 4).join(t("common.listSeparator")) })
      : "";
  return `${cast}${t("work.metaDescription", {
    category: categoryLabel(detail.work.category, locale),
    title: detail.work.title,
    stores: storeList(detail, locale),
  })}`;
}

function RouteComponent() {
  const { detail } = Route.useLoaderData();
  return <WorkPage detail={detail} />;
}
