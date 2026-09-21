import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/app/components/ui/button";
import { useLocale, useT } from "@/app/i18n";
import { actorDisplayName } from "@/app/lib/actor-name";
import { formatYearMonth } from "@/app/lib/format";
import { fetchWorkStatsForActors } from "@/app/server-fns/works";
import { useFollowStore } from "@/app/store/follow-store";

/**
 * フォローの管理。作品一覧の前置きなので、名前と最新リリースと解除だけを横に詰めて置く。
 * 声優ページへ行かなくてもここから解除できることが、このページを「一覧」にしている条件。
 *
 * 名前の隣に最新リリースの年月を出すのは、フォローしても当面は何も届かない声優が多いため。
 * フィードが空でも、その人のいちばん新しい作品がいつのものかはここで分かる
 * (発売予定の作品があればその年月になる。`ActorWorkStats`)。
 * フォロー ID はサーバーが知らないので、フィードと同じくまとめて送って引き直す
 */
export function FollowManager() {
  const t = useT();
  const locale = useLocale();
  const follows = useFollowStore((state) => state.follows);
  const unfollow = useFollowStore((state) => state.unfollow);
  const latestReleases = useLatestReleases();

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="font-medium text-sm">
        {t("following.manageTitle", { count: follows.length })}
      </h2>
      <ul aria-label={t("following.listLabel")} className="flex flex-wrap gap-2">
        {follows.map((actor) => {
          const name = actorDisplayName(actor, locale);
          const latest = latestReleases.get(actor.voiceActorId);
          return (
            <li
              key={actor.voiceActorId}
              className="inline-flex items-center gap-1 rounded-full border bg-background py-1 pr-1 pl-3 text-sm"
            >
              <Link
                to="/voice-actors/$slug"
                params={{ slug: actor.slug }}
                className="hover:underline"
              >
                {name}
              </Link>
              {latest ? (
                <span className="text-muted-foreground text-xs">
                  {/* 年月だけでは何の日付か分からない。読み上げにだけ名前を足す */}
                  <span className="sr-only">{t("following.latestReleaseLabel")}</span>
                  {formatYearMonth(latest, locale)}
                </span>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t("follow.unfollowActor", { name })}
                className="rounded-full"
                onClick={() => void unfollow(actor.voiceActorId)}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          );
        })}
      </ul>
      <p className="text-muted-foreground text-xs">{t("following.storageNote")}</p>
    </section>
  );
}

/**
 * フォロー中の声優ごとの、いちばん新しい発売日。作品を 1 件も持たない声優は入らない。
 *
 * 引けなかったときは何も出さない。このページの主役は作品の一覧で、
 * 年月は名前に添える手がかりなので、失敗を知らせる価値がない (`FollowedAnime` と同じ)
 */
function useLatestReleases(): Map<string, string> {
  const follows = useFollowStore((state) => state.follows);
  const [latestReleases, setLatestReleases] = useState<Map<string, string>>(new Map());

  // 配列は毎レンダリング作り直されるため、依存には中身から作った文字列を使う
  const followKey = follows
    .map((actor) => actor.voiceActorId)
    .sort()
    .join(",");

  useEffect(() => {
    if (followKey.length === 0) {
      setLatestReleases(new Map());
      return;
    }
    let current = true;

    fetchWorkStatsForActors({ data: { voiceActorIds: followKey.split(",") } })
      .then((stats) => {
        if (!current) return;
        setLatestReleases(
          new Map(
            stats.flatMap((entry) =>
              entry.latestReleaseDate ? [[entry.voiceActorId, entry.latestReleaseDate]] : [],
            ),
          ),
        );
      })
      .catch(() => {
        if (current) setLatestReleases(new Map());
      });

    return () => {
      current = false;
    };
  }, [followKey]);

  return latestReleases;
}
