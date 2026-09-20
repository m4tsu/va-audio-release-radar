import { useEffect, useState } from "react";
import { AnimeCard } from "@/app/components/anime-card";
import { useT } from "@/app/i18n";
import type { AnimeSummary } from "@/app/lib/view-types";
import { fetchAnimeForActors } from "@/app/server-fns/anime";
import { useFollowStore } from "@/app/store/follow-store";

/** 並べる上限。シーズンをまたいで溜まるので、フィードより少なめに切る */
const ANIME_LIMIT = 24;

type AnimeState =
  | { phase: "loading" }
  | { phase: "ready"; items: AnimeSummary[] }
  | { phase: "error" };

/**
 * フォロー中の声優が出ているアニメ。
 *
 * フォロー ID はサーバーが知らないので、フィードと同じくまとめて送って引き直す。
 * 引けなかったときは何も出さない。このページの主役は音声作品で、
 * アニメは「フォローした人を思い出す手がかり」なので、失敗を知らせる価値がない
 */
export function FollowedAnime() {
  const t = useT();
  const follows = useFollowStore((state) => state.follows);
  const [state, setState] = useState<AnimeState>({ phase: "loading" });

  // 配列は毎レンダリング作り直されるため、依存には中身から作った文字列を使う
  const followKey = follows
    .map((actor) => actor.voiceActorId)
    .sort()
    .join(",");

  useEffect(() => {
    if (followKey.length === 0) return;
    let current = true;
    setState({ phase: "loading" });

    fetchAnimeForActors({ data: { voiceActorIds: followKey.split(","), limit: ANIME_LIMIT } })
      .then((items) => {
        if (current) setState({ phase: "ready", items });
      })
      .catch(() => {
        if (current) setState({ phase: "error" });
      });

    return () => {
      current = false;
    };
  }, [followKey]);

  if (state.phase === "loading") {
    return <p className="text-muted-foreground text-sm">{t("common.loading")}</p>;
  }
  if (state.phase === "error" || state.items.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="font-medium text-lg">{t("following.animeTitle")}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {state.items.map((item) => (
          <AnimeCard key={item.slug} anime={item} showSeason />
        ))}
      </div>
    </section>
  );
}
