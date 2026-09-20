import { Link } from "@tanstack/react-router";
import { storeLabel } from "@/app/components/store-badge";
import { StoreLink } from "@/app/components/store-link";
import { Badge } from "@/app/components/ui/badge";
import { Separator } from "@/app/components/ui/separator";
import { useLocale, useT } from "@/app/i18n";
import { actorDisplayName } from "@/app/lib/actor-name";
import { dedupeCredits } from "@/app/lib/dedupe-credits";
import { categoryLabel, formatDuration, formatReleaseDate } from "@/app/lib/format";
import { safeHttpsUrl } from "@/app/lib/safe-url";
import type { WorkCredit, WorkDetail, WorkListing } from "@/app/lib/view-types";

/**
 * 作品ページ。
 *
 * ストアへの導線が主役で、クレジットは「誰が出ているか」を確かめる材料。
 * 名寄せできたクレジットだけを声優ページへ結び、未解決の表記はストア上の書き方のまま出す
 */
export function WorkPage({ detail }: { detail: WorkDetail }) {
  const t = useT();
  const locale = useLocale();
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

/**
 * ストア 1 つぶんの導線。価格と販売状況は出さない。
 * このサイトは価格を持たず、正はストアの側にある (docs/decisions/0008-no-price-no-availability.md)
 */
function ListingCard({ listing }: { listing: WorkListing }) {
  const t = useT();

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4 text-card-foreground shadow-sm">
      <p className="font-medium">{storeLabel(listing.storeSlug)}</p>

      <StoreLink listing={listing} className="w-full" />

      <p className="text-muted-foreground text-xs">{t("work.checkAtStore")}</p>
    </div>
  );
}
