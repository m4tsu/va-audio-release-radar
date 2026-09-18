import { Link } from "@tanstack/react-router";
import { StoreBadge } from "@/app/components/store-badge";
import { Badge } from "@/app/components/ui/badge";
import { dedupeCredits } from "@/app/lib/dedupe-credits";
import {
  categoryLabel,
  formatDuration,
  formatMonthDay,
  formatPrice,
  formatReleaseDate,
} from "@/app/lib/format";
import { safeHttpsUrl } from "@/app/lib/safe-url";
import type { WorkWithListings } from "@/app/lib/view-types";

/**
 * 新着一覧の 1 作品。企画書 §6 のホーム画面に出す情報をこの 1 枚に収める。
 *
 * 評価もおすすめ度も出さない。出すのは「誰が出ている、どこで買える、いつ出た、いくら」だけ (企画書 §7)
 */
export function WorkCard({
  item,
  actors,
  unread = false,
}: {
  item: WorkWithListings;
  /** フィードで「フォロー中の誰で引っかかったか」を出すとき。声優ページでは省く */
  actors?: Array<{ id: string; slug: string; name: string }>;
  /**
   * 前回フィードを見たとき以降の作品。ブラウザにしか無い状態なので SSR では常に false で、
   * ハイドレーション後にだけ印が付く (設計書 §10)
   */
  unread?: boolean;
}) {
  const { work, listings } = item;
  // 表記違いで同じ声優に複数の credit が解決されていると、ここも同じ声優が重複して出るので排除する
  // (この配列は常に名寄せ済みの声優なので voiceActorId 相当の id で重複排除すれば足りる)
  const dedupedActors = actors
    ? dedupeCredits(actors, (actor) => ({ voiceActorId: actor.id, creditedName: actor.name }))
    : undefined;
  const upcoming = item.freshness === "upcoming";

  return (
    <article className="relative flex gap-4 rounded-xl border bg-card p-3 text-card-foreground shadow-sm">
      {unread ? (
        // 未読は「前回見たとき以降に出た / 見つかった」の合図。色だけに頼らないよう
        // 読み上げ用のラベルを中に置く (live region にはしない。並んだ枚数だけ読み上げてしまう)
        <span className="absolute top-3 left-1 h-6 w-1 rounded-full bg-primary">
          <span className="sr-only">未読</span>
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
        <div className="flex flex-wrap items-center gap-1.5">
          {listings.map((listing) => (
            <StoreBadge key={listing.storeSlug} store={listing.storeSlug} />
          ))}
          <Badge variant="secondary">{categoryLabel(work.category)}</Badge>
          {item.isNew ? <Badge>NEW</Badge> : null}
          {upcoming && work.releaseDate ? (
            <Badge variant="outline">発売予定 {formatMonthDay(work.releaseDate)}</Badge>
          ) : null}
        </div>

        <h3 className="font-medium leading-snug">
          <Link to="/works/$id" params={{ id: work.id }} className="hover:underline">
            {work.title}
          </Link>
        </h3>

        {dedupedActors && dedupedActors.length > 0 ? (
          <p className="flex flex-wrap gap-x-2 gap-y-1 text-sm">
            {dedupedActors.map((actor) => (
              <Link
                key={actor.id}
                to="/voice-actors/$slug"
                params={{ slug: actor.slug }}
                className="text-muted-foreground hover:text-foreground hover:underline"
              >
                {actor.name}
              </Link>
            ))}
          </p>
        ) : null}

        <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground text-sm">
          {work.makerName ? (
            <div className="flex gap-1">
              <dt className="sr-only">サークル / 出版社</dt>
              <dd className="truncate">{work.makerName}</dd>
            </div>
          ) : null}
          {/* 発売予定の作品は上のバッジで日付を出しているので、ここには重ねて出さない */}
          {work.releaseDate && !upcoming ? (
            <div className="flex gap-1">
              <dt className="sr-only">発売日</dt>
              <dd>{formatReleaseDate(work.releaseDate)}</dd>
            </div>
          ) : null}
          {work.durationSeconds ? (
            <div className="flex gap-1">
              <dt className="sr-only">再生時間</dt>
              <dd>{formatDuration(work.durationSeconds)}</dd>
            </div>
          ) : null}
        </dl>

        <p className="flex flex-wrap items-baseline gap-x-3 text-sm">
          {listings.map((listing) =>
            listing.price === undefined ? null : (
              <span key={listing.storeSlug} className="font-medium">
                {formatPrice(listing.price)}
                <span className="ml-1 font-normal text-muted-foreground text-xs">
                  {listing.storeSlug === "dlsite" ? "DLsite" : "Audible"}
                </span>
              </span>
            ),
          )}
        </p>
      </div>
    </article>
  );
}

/**
 * 表紙。取得できていない作品もあるので、その場合は同じ大きさの枠だけ出して行がずれないようにする。
 * https 以外の URL は「取得できていない」と同じ扱いにする (`data:` などを src に出さない)
 */
function Cover({ work }: { work: WorkWithListings["work"] }) {
  const coverImageUrl = safeHttpsUrl(work.coverImageUrl);
  if (!coverImageUrl) {
    return (
      <div className="flex h-20 w-28 items-center justify-center rounded-md bg-muted text-muted-foreground text-xs">
        no image
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
