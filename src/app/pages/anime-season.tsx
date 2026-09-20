import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";
import { AnimeCard } from "@/app/components/anime-card";
import { EmptyState } from "@/app/components/empty-state";
import { PageHeader } from "@/app/components/page-header";
import { useLocale, useT } from "@/app/i18n";
import { type SeasonKey, seasonLabel, toSeasonSlug } from "@/app/lib/season";
import type { SeasonAnime } from "@/app/lib/view-types";
import { useFollowStore } from "@/app/store/follow-store";
import type { AnimeSeason } from "@/domain/types";

/**
 * シーズンのアニメ一覧。
 *
 * 声優名を知らない利用者がアニメから入ってくる経路。放送中のアニメは毎クール入れ替わるので、
 * back catalog 中心の他のページに無い「時期性」をここが受け持つ。
 *
 * フォロー中の声優が出ている作品の印と絞り込みは、サーバーから来た出演者 ID と
 * ブラウザ内のフォローを突き合わせて出す。サーバーはフォローを知らないので、
 * SSR の応答はフォローの有無で変わらず、印はハイドレーション後に現れる
 */
export function AnimeSeasonPage({
  anime,
  seasonYear,
  season,
  older,
  newer,
}: {
  anime: SeasonAnime[];
  seasonYear: number;
  season: AnimeSeason;
  older?: SeasonKey;
  newer?: SeasonKey;
}) {
  const t = useT();
  const locale = useLocale();
  const label = seasonLabel(seasonYear, season, locale);
  const follows = useFollowStore((state) => state.follows);
  const [followedOnly, setFollowedOnly] = useState(false);
  const filterId = useId();

  const followedIds = new Set(follows.map((actor) => actor.voiceActorId));
  const hasFollow = followedIds.size > 0;
  const isFollowed = (item: SeasonAnime) => item.actorIds.some((id) => followedIds.has(id));
  // 絞り込みの選択はフォローが消えても残る。フォロー 0 件では出さないので無視して全件を出す
  const shown = hasFollow && followedOnly ? anime.filter(isFollowed) : anime;

  return (
    <div className="space-y-6">
      <PageHeader title={t("anime.seasonTitle", { season: label })} />

      <SeasonNav older={older} newer={newer} />

      {hasFollow && anime.length > 0 ? (
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id={filterId}
            checked={followedOnly}
            onChange={(event) => setFollowedOnly(event.target.checked)}
            className="size-4 rounded border-input accent-primary"
          />
          <label htmlFor={filterId} className="text-sm">
            {t("anime.followedFilterLabel")}
          </label>
        </div>
      ) : null}

      {anime.length === 0 ? (
        <EmptyState title={t("anime.seasonEmptyTitle", { season: label })} />
      ) : shown.length === 0 ? (
        <EmptyState title={t("anime.followedEmptyTitle")} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((item) => (
            <AnimeCard key={item.slug} anime={item} followed={isFollowed(item)} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 前後のシーズンへの導線。行き先は「実際に作品があるシーズン」なので、
 * いちばん古い / 新しいシーズンではその向きが出ない (`adjacentSeasons`)
 */
function SeasonNav({ older, newer }: { older?: SeasonKey; newer?: SeasonKey }) {
  const t = useT();
  const locale = useLocale();

  return (
    <nav className="grid grid-cols-3 items-center gap-3 text-sm">
      <div>
        {older ? (
          <Link
            to="/anime/season/$season"
            params={{ season: toSeasonSlug(older.seasonYear, older.season) }}
            className="underline underline-offset-4"
          >
            {t("anime.olderSeason", {
              season: seasonLabel(older.seasonYear, older.season, locale),
            })}
          </Link>
        ) : null}
      </div>

      <div className="text-center">
        <Link to="/anime" className="text-muted-foreground underline underline-offset-4">
          {t("anime.allSeasons")}
        </Link>
      </div>

      <div className="text-right">
        {newer ? (
          <Link
            to="/anime/season/$season"
            params={{ season: toSeasonSlug(newer.seasonYear, newer.season) }}
            className="underline underline-offset-4"
          >
            {t("anime.newerSeason", {
              season: seasonLabel(newer.seasonYear, newer.season, locale),
            })}
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
