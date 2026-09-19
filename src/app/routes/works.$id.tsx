import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { storeLabel } from "@/app/components/store-badge";
import { StoreLink } from "@/app/components/store-link";
import { Badge } from "@/app/components/ui/badge";
import { Separator } from "@/app/components/ui/separator";
import { createTranslator, type Locale, useLocale, useT } from "@/app/i18n";
import { actorDisplayName } from "@/app/lib/actor-name";
import { dedupeCredits } from "@/app/lib/dedupe-credits";
import {
  categoryLabel,
  formatDateTime,
  formatDuration,
  formatPrice,
  formatReleaseDate,
} from "@/app/lib/format";
import { safeHttpsUrl } from "@/app/lib/safe-url";
import type { WorkCredit, WorkDetail, WorkListing } from "@/app/lib/view-types";
import { siteOriginForLoader } from "@/app/server-fns/site";
import { fetchWork } from "@/app/server-fns/works";

/**
 * 作品ページ。
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
    return { ...detail, origin };
  },
  head: ({ loaderData, match }) => {
    if (!loaderData) return {};
    const locale = match.context.locale;
    const title = pageTitle(loaderData, locale);
    const description = pageDescription(loaderData, locale);
    // 作品 ID は "dlsite:RJ01698658" のようにコロンを含むので符号化してから並べる
    const path = `/works/${encodeURIComponent(loaderData.work.id)}`;
    const canonical = loaderData.origin ? `${loaderData.origin}${path}` : path;
    const cover = safeHttpsUrl(loaderData.work.coverImageUrl);

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
  component: WorkPage,
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

function WorkPage() {
  const t = useT();
  const locale = useLocale();
  const detail = Route.useLoaderData();
  const { work, listings } = detail;
  // 表記違いで同じ声優に解決された credit が複数残ることがあるので、表示前に重複排除する
  const credits = dedupeCredits(detail.credits);
  // https 以外の表紙 URL は出さない (DB には検証を足す前に入った行が残りうる)
  const coverImageUrl = safeHttpsUrl(work.coverImageUrl);

  return (
    <article className="space-y-8">
      <header className="flex flex-col gap-6 sm:flex-row">
        {coverImageUrl ? (
          <img
            src={coverImageUrl}
            alt=""
            className="w-full max-w-xs rounded-xl border object-cover"
          />
        ) : null}

        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary">{categoryLabel(work.category, locale)}</Badge>
            {listings.map((listing) => (
              <Badge key={listing.storeSlug} variant="outline">
                {storeLabel(listing.storeSlug)}
              </Badge>
            ))}
          </div>

          <h1 className="font-semibold text-2xl tracking-tight">{work.title}</h1>

          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            {work.makerName ? (
              <>
                <dt className="text-muted-foreground">{t("work.makerName")}</dt>
                <dd>{work.makerName}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">{t("work.releaseDate")}</dt>
            <dd>
              {work.releaseDate ? formatReleaseDate(work.releaseDate, locale) : t("common.unknown")}
            </dd>
            {/* DLsite は再生時間を提供せず常に不明になるので、値が無い作品は行ごと出さない */}
            {work.durationSeconds ? (
              <>
                <dt className="text-muted-foreground">{t("work.duration")}</dt>
                <dd>{formatDuration(work.durationSeconds, locale)}</dd>
              </>
            ) : null}
          </dl>
        </div>
      </header>

      <Separator />

      <section className="space-y-3">
        <h2 className="font-semibold text-xl tracking-tight">{t("work.castTitle")}</h2>
        {credits.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("work.castEmpty")}</p>
        ) : (
          <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {credits.map((credit) => (
              <li key={`${credit.sourceStoreSlug}:${credit.creditedName}`}>
                <CreditName credit={credit} />
                {credit.role ? (
                  <span className="ml-1 text-muted-foreground text-xs">{credit.role}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold text-xl tracking-tight">{t("work.purchaseTitle")}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {listings.map((listing) => (
            <ListingCard key={listing.storeSlug} listing={listing} />
          ))}
        </div>
      </section>
    </article>
  );
}

/**
 * クレジット 1 件。名寄せ済みなら声優ページへ送る。
 * 未解決のものはストア上の表記のまま出す (確証の無い同一視をしない)
 */
function CreditName({ credit }: { credit: WorkCredit }) {
  const locale = useLocale();
  if (credit.voiceActorSlug) {
    return (
      <Link
        to="/voice-actors/$slug"
        params={{ slug: credit.voiceActorSlug }}
        className="font-medium hover:underline"
      >
        {actorDisplayName({ canonicalName: credit.voiceActorName ?? credit.creditedName }, locale)}
      </Link>
    );
  }
  // 名寄せできていない表記はストア上の書き方のまま出す
  return <span>{credit.creditedName}</span>;
}

function ListingCard({ listing }: { listing: WorkListing }) {
  const t = useT();
  const locale = useLocale();
  const onSale = listing.listPrice !== undefined && listing.listPrice !== listing.price;

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4 text-card-foreground shadow-sm">
      <p className="font-medium">{storeLabel(listing.storeSlug)}</p>

      <p className="flex items-baseline gap-2">
        <span className="font-semibold text-xl">
          {listing.price === undefined
            ? t("work.priceUnknown")
            : formatPrice(listing.price, locale)}
        </span>
        {onSale && listing.listPrice !== undefined ? (
          <span className="text-muted-foreground text-sm line-through">
            {formatPrice(listing.listPrice, locale)}
          </span>
        ) : null}
      </p>

      {listing.available ? null : (
        <p className="text-muted-foreground text-sm">{t("work.unavailable")}</p>
      )}

      <StoreLink listing={listing} className="w-full" />

      <p className="text-muted-foreground text-xs">
        {t("work.priceSeenAt", { at: formatDateTime(listing.lastSeenAt, locale) })}
      </p>
    </div>
  );
}
