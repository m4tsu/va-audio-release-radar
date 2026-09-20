import { Link } from "@tanstack/react-router";
import { Badge } from "@/app/components/ui/badge";
import { useLocale, useT } from "@/app/i18n";
import { animeDisplayTitle } from "@/app/lib/anime-title";
import { safeHttpsUrl } from "@/app/lib/safe-url";
import { seasonLabel } from "@/app/lib/season";
import type { AnimeSummary } from "@/app/lib/view-types";

/**
 * アニメ 1 本のカード。シーズンの一覧とフォロー中のページが同じ形で並べる。
 *
 * カード全体が 1 つのリンクなので、中に押せるものを置かない
 * (フォローの操作はアニメのページのキャスト表に置く)
 */
export function AnimeCard({
  anime,
  followed = false,
  showSeason = false,
}: {
  anime: AnimeSummary;
  /** フォロー中の声優が出ているか。ブラウザにしか無い情報なので、呼び出し側が判定して渡す */
  followed?: boolean;
  /** シーズンをまたいで並べるときだけ出す。シーズンの一覧では見出しと重複する */
  showSeason?: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const cover = safeHttpsUrl(anime.coverImageUrl);

  return (
    <Link
      to="/anime/$slug"
      params={{ slug: anime.slug }}
      className="flex gap-3 rounded-xl border p-3 transition-colors hover:bg-accent"
    >
      {cover ? (
        <img
          src={cover}
          alt=""
          className="h-24 w-16 shrink-0 rounded-md object-cover"
          loading="lazy"
        />
      ) : null}
      <div className="min-w-0 space-y-1">
        <p className="font-medium leading-snug">{animeDisplayTitle(anime, locale)}</p>
        {showSeason ? (
          <p className="text-muted-foreground text-xs">
            {seasonLabel(anime.seasonYear, anime.season, locale)}
          </p>
        ) : null}
        <p className="text-muted-foreground text-xs">
          {t("anime.actorCount", { count: anime.actorCount })}
        </p>
        {followed ? <Badge variant="secondary">{t("anime.followedMark")}</Badge> : null}
      </div>
    </Link>
  );
}
