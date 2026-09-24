import { Link } from "@tanstack/react-router";
import { AppearanceBadge } from "@/app/components/appearance-badge";
import { StoreBadge } from "@/app/components/store-badge";
import { Badge } from "@/app/components/ui/badge";
import { useLocale, useT } from "@/app/i18n";
import { actorDisplayName } from "@/app/lib/actor-name";
import { dedupeCredits } from "@/app/lib/dedupe-credits";
import {
  categoryLabel,
  formatDuration,
  formatMonthDay,
  formatReleaseDate,
  formatYearMonth,
} from "@/app/lib/format";
import { listedAt } from "@/app/lib/listed-at";
import { safeHttpsUrl } from "@/app/lib/safe-url";
import type { WorkWithListings } from "@/app/lib/view-types";

/**
 * 新着一覧の 1 作品。ホーム画面に出す情報をこの 1 枚に収める。
 *
 * 評価もおすすめ度も出さない。出すのは「誰が出ている、どこで買える、いつ出た」だけ
 */
export function WorkCard({
  item,
  actors,
  actorLimit,
  unread = false,
}: {
  item: WorkWithListings;
  /**
   * 出す声優。新着ではその作品に出ている名寄せ済みの声優、フィードでは「フォロー中の誰で
   * 引っかかったか」。声優ページでは省く (そのページの声優なので重ねて出さない)。
   * `nameEn` は入っていれば英語表示で使う
   */
  actors?: Array<{ id: string; slug: string; name: string; nameEn?: string }>;
  /**
   * 名前を出す人数の上限。超えた分は人数だけを添える (全員はその作品のページで見る)。
   * 渡さなければ全員出す。フィードが渡さないのは、そこに並ぶのがフォロー中の声優だけで、
   * 「自分のどのフォローで引っかかったか」は畳まずに見せる欄だから
   */
  actorLimit?: number;
  /**
   * 前回フィードを見たとき以降の作品。ブラウザにしか無い状態なので SSR では常に false で、
   * ハイドレーション後にだけ印が付く
   */
  unread?: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const { work, listings } = item;
  // 表記違いで同じ声優に複数の credit が解決されていると、ここも同じ声優が重複して出るので排除する
  // (この配列は常に名寄せ済みの声優なので voiceActorId 相当の id で重複排除すれば足りる)
  const dedupedActors = actors
    ? dedupeCredits(actors, (actor) => ({ voiceActorId: actor.id, creditedName: actor.name }))
    : [];
  // 上限は重複を除いた後にかける。表記違いの分で枠が埋まると出る人数が作品ごとに変わる
  const shownActors = actorLimit === undefined ? dedupedActors : dedupedActors.slice(0, actorLimit);
  const hiddenActorCount = dedupedActors.length - shownActors.length;
  const upcoming = item.freshness === "upcoming";
  // 発売日が無い作品にだけ入る。発売日の代わりに出す「掲載を見つけた時点」
  const listed = listedAt(item);

  return (
    <article className="relative flex gap-4 rounded-xl border bg-card p-3 text-card-foreground shadow-sm">
      {unread ? (
        // 未読は「前回見たとき以降に出た / 見つかった」の合図。色だけに頼らないよう
        // 読み上げ用のラベルを中に置く (live region にはしない。並んだ枚数だけ読み上げてしまう)
        <span className="absolute top-3 left-1 h-6 w-1 rounded-full bg-primary">
          <span className="sr-only">{t("work.unread")}</span>
        </span>
      ) : null}

      <Link
        to="/works/$id"
        params={{ id: work.id }}
        className="shrink-0"
        aria-hidden="true"
        tabIndex={-1}
      >
        <Cover work={work} />
      </Link>

      <div className="min-w-0 flex-1 space-y-2">
        {/*
          バッジは 3 つの層でできている。どこで買えるか (ストア、ストアごとの色) と、
          新しいか (NEW と発売予定、highlight 色) と、作品の属性 (形式と出演形態、無彩色)。
          層の別は色で読ませ、どのバッジが何を指すかは文言だけで分かる状態を保つ
        */}
        <div className="flex flex-wrap items-center gap-1.5">
          {listings.map((listing) => (
            <StoreBadge key={listing.storeSlug} store={listing.storeSlug} />
          ))}
          <Badge variant="secondary">{categoryLabel(work.category, locale)}</Badge>
          <AppearanceBadge castSize={item.castSize} />
          {/*
            新しさは一番強く出す層なので、この 1 枚だけ色で塗る。
            発売日が無い作品の「新しい」は発売ではなく掲載を見つけたことなので語を分ける
            (サーバー側の判定 `classifyWork` も発売日の有無で分岐している)
          */}
          {item.isNew ? (
            <Badge className="bg-highlight text-highlight-foreground">
              {work.releaseDate ? t("work.badgeNew") : t("work.badgeListed")}
            </Badge>
          ) : null}
          {upcoming && work.releaseDate ? (
            <Badge variant="outline" className="border-highlight/40 bg-highlight/10 text-highlight">
              {t("work.badgeUpcoming", { date: formatMonthDay(work.releaseDate, locale) })}
            </Badge>
          ) : null}
        </div>

        <h3 className="font-medium leading-snug">
          <Link
            to="/works/$id"
            params={{ id: work.id }}
            className="link-text [--link-tone:var(--color-foreground)]"
          >
            {work.title}
          </Link>
        </h3>

        {shownActors.length > 0 ? (
          <p className="flex flex-wrap gap-x-2 gap-y-1 text-sm">
            {shownActors.map((actor) => (
              <Link
                key={actor.id}
                to="/voice-actors/$slug"
                params={{ slug: actor.slug }}
                className="link-text"
              >
                {actorDisplayName(
                  { canonicalName: actor.name, ...(actor.nameEn ? { nameEn: actor.nameEn } : {}) },
                  locale,
                )}
              </Link>
            ))}
            {hiddenActorCount > 0 ? (
              // 残りはここでは開かない。全員はその作品のページで見る
              <span className="text-muted-foreground">
                {t("work.castMore", { count: hiddenActorCount })}
              </span>
            ) : null}
          </p>
        ) : null}

        <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground text-sm">
          {work.makerName ? (
            <div className="flex gap-1">
              <dt className="sr-only">{t("work.makerName")}</dt>
              <dd className="truncate">{work.makerName}</dd>
            </div>
          ) : null}
          {/* 発売予定の作品は上のバッジで日付を出しているので、ここには重ねて出さない */}
          {work.releaseDate && !upcoming ? (
            <div className="flex gap-1">
              <dt className="sr-only">{t("work.releaseDate")}</dt>
              <dd>{formatReleaseDate(work.releaseDate, locale)}</dd>
            </div>
          ) : null}
          {/*
            発売日が無い作品は、この行が無いと時点が何も読めない。見出しを表に出すのは、
            発売日と同じ見た目で月だけ並ぶと発売日として読まれるため
          */}
          {listed ? (
            <div className="flex gap-1">
              <dt>{t("work.listedAt")}</dt>
              <dd>{formatYearMonth(listed, locale)}</dd>
            </div>
          ) : null}
          {work.durationSeconds ? (
            <div className="flex gap-1">
              <dt className="sr-only">{t("work.duration")}</dt>
              <dd>{formatDuration(work.durationSeconds, locale)}</dd>
            </div>
          ) : null}
        </dl>
      </div>
    </article>
  );
}

/**
 * 表紙。取得できていない作品もあるので、その場合は同じ大きさの枠だけ出して行がずれないようにする。
 * https 以外の URL は「取得できていない」と同じ扱いにする (`data:` などを src に出さない)
 */
function Cover({ work }: { work: WorkWithListings["work"] }) {
  const t = useT();
  const coverImageUrl = safeHttpsUrl(work.coverImageUrl);
  if (!coverImageUrl) {
    return (
      <div className="flex h-20 w-28 items-center justify-center rounded-md bg-muted text-muted-foreground text-xs">
        {t("work.noImage")}
      </div>
    );
  }
  return (
    <img
      src={coverImageUrl}
      alt=""
      loading="lazy"
      decoding="async"
      className="h-20 w-28 rounded-md object-cover"
    />
  );
}
