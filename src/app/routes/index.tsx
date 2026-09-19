import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ActorSearch } from "@/app/components/actor-search";
import { EmptyState } from "@/app/components/empty-state";
import { Badge } from "@/app/components/ui/badge";
import { WorkCard } from "@/app/components/work-card";
import { useLocale, useT } from "@/app/i18n";
import { actorDisplayName } from "@/app/lib/actor-name";
import { isUnreadSince } from "@/app/lib/format";
import { safeHttpsUrl } from "@/app/lib/safe-url";
import { seasonLabel, toSeasonSlug } from "@/app/lib/season";
import type { ActorSummary, AnimeSummary, FeedItem } from "@/app/lib/view-types";
import { fetchAllActors } from "@/app/server-fns/actors";
import { fetchLatestAnimeSeason, fetchSeasonAnime } from "@/app/server-fns/anime";
import { fetchFeed, fetchLatestWorks } from "@/app/server-fns/works";
import { useFollowStore } from "@/app/store/follow-store";

/**
 * フィードが遡る期間 (設計書 §10)。3 段目「それ以前」の下限でもある。
 * 段分け (今後の発売 / 30 日以内 / それ以前) はサーバーが `freshness` として付けてくる
 */
const FEED_SINCE_DAYS = 90;
/**
 * 2 段目の見出しに出す日数。判定そのものはサーバー (`RECENT_DAYS`) が持っているので、
 * ここは表示用の写し。サーバーはクライアントから import できない (D1 に触るため)
 */
const FEED_RECENT_DAYS = 30;
const FEED_LIMIT = 60;
/** フォロー 0 件のときの「最近の新着」。こちらは見出しどおり直近 30 日に絞る */
const LATEST_SINCE_DAYS = 30;
const LATEST_LIMIT = 24;
/** トップに並べる今期アニメの件数。続きはシーズンのページで見せる */
const SEASON_ANIME_LIMIT = 6;

/**
 * トップ (企画書 §13)。
 *
 * SSR で出すのは検索欄・全声優の新着・声優一覧まで。フォローはブラウザ内にしか無いので、
 * 「フォロー中の新着」はマウント後にフォロー ID を読んでから server function で取りに行く
 */
export const Route = createFileRoute("/")({
  loader: async () => {
    const [latest, actors, season] = await Promise.all([
      fetchLatestWorks({ data: { sinceDays: LATEST_SINCE_DAYS, limit: LATEST_LIMIT } }),
      fetchAllActors(),
      // 「今期」を日付から決めない。実際にデータがあるシーズンを出す (queries/anime.ts)
      fetchLatestAnimeSeason(),
    ]);
    const seasonAnime = season === null ? [] : await fetchSeasonAnime({ data: season });
    return { latest, actors, season, seasonAnime };
  },
  component: HomePage,
});

function HomePage() {
  const { latest, actors, season, seasonAnime } = Route.useLoaderData();
  const follows = useFollowStore((state) => state.follows);
  const status = useFollowStore((state) => state.status);

  return (
    <div className="space-y-10">
      <ActorSearch />

      {season && seasonAnime.length > 0 ? (
        <SeasonAnimeSection season={season} anime={seasonAnime} />
      ) : null}

      {follows.length > 0 ? (
        <FollowingFeed />
      ) : (
        <>
          {status === "ready" ? <FollowPrompt /> : null}
          <LatestSection latest={latest} />
          <ActorDirectory actors={actors} />
        </>
      )}
    </div>
  );
}

/** フォローが 0 件のときだけ出す説明。何をすればこのサービスが動き出すかを 1 行で示す */
function FollowPrompt() {
  const t = useT();
  return (
    <p className="rounded-xl border bg-muted/40 px-4 py-3 text-sm">{t("home.followPrompt")}</p>
  );
}

function LatestSection({ latest }: { latest: Awaited<ReturnType<typeof fetchLatestWorks>> }) {
  const t = useT();
  return (
    <section className="space-y-4">
      <h1 className="font-semibold text-2xl tracking-tight">{t("home.latestTitle")}</h1>
      {latest.length === 0 ? (
        <EmptyState
          title={t("home.latestEmptyTitle")}
          description={t("home.latestEmptyDescription")}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {latest.map((item) => (
            <WorkCard key={item.work.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

function ActorDirectory({ actors }: { actors: ActorSummary[] }) {
  const t = useT();
  const locale = useLocale();

  if (actors.length === 0) return null;
  return (
    <section className="space-y-4">
      <h2 className="font-semibold text-xl tracking-tight">{t("home.actorDirectoryTitle")}</h2>
      <ul className="flex flex-wrap gap-2">
        {actors.map((actor) => (
          <li key={actor.id}>
            <Link
              to="/voice-actors/$slug"
              params={{ slug: actor.slug }}
              className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
            >
              {actorDisplayName(actor, locale)}
              <Badge variant="secondary">{actor.workCount}</Badge>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

type FeedState = { phase: "loading" } | { phase: "ready"; items: FeedItem[] } | { phase: "error" };

/**
 * フォロー中の声優の新着。
 *
 * フォロー ID はサーバーが知らないので、毎回まとめて送って引き直す。
 * フォローの増減でキーが変わったときだけ取り直す
 */
function FollowingFeed() {
  const t = useT();
  const follows = useFollowStore((state) => state.follows);
  const [state, setState] = useState<FeedState>({ phase: "loading" });

  // 配列は毎レンダリング作り直されるため、依存には中身から作った文字列を使う
  const followKey = follows
    .map((actor) => actor.voiceActorId)
    .sort()
    .join(",");

  useEffect(() => {
    if (followKey.length === 0) return;
    let current = true;
    setState({ phase: "loading" });

    fetchFeed({
      data: {
        voiceActorIds: followKey.split(","),
        sinceDays: FEED_SINCE_DAYS,
        limit: FEED_LIMIT,
      },
    })
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

  return (
    <section className="space-y-4">
      <h1 className="font-semibold text-2xl tracking-tight">{t("home.feedTitle")}</h1>
      <p className="text-muted-foreground text-sm">
        {t("home.feedSummary", { count: follows.length, days: FEED_SINCE_DAYS })}
      </p>

      {state.phase === "loading" ? (
        <p className="text-muted-foreground text-sm">{t("common.loading")}</p>
      ) : null}
      {state.phase === "error" ? (
        <EmptyState title={t("home.feedErrorTitle")} description={t("home.feedErrorDescription")} />
      ) : null}
      {state.phase === "ready" ? <FeedTiers items={state.items} /> : null}
    </section>
  );
}

/**
 * 未読の基準になる「前回フィードを見た日時」。
 *
 * 描画に使うのは更新前の値。先に保存してしまうと、開いた瞬間に全件が既読になって
 * 印が一度も出ない。初回 (null) は印を出さずに今の時刻だけ保存する (設計書 §10)
 */
function useFeedSeenBaseline(ready: boolean): string | null {
  const status = useFollowStore((state) => state.status);
  const lastSeenFeedAt = useFollowStore((state) => state.lastSeenFeedAt);
  const markFeedSeen = useFollowStore((state) => state.markFeedSeen);
  const [baseline, setBaseline] = useState<string | null>(null);
  const captured = useRef(false);

  useEffect(() => {
    // Dexie の読み込みが終わり、フィードが描けてから 1 度だけ控える
    if (!ready || status !== "ready" || captured.current) return;
    captured.current = true;
    setBaseline(lastSeenFeedAt);
    void markFeedSeen(new Date().toISOString());
  }, [ready, status, lastSeenFeedAt, markFeedSeen]);

  return baseline;
}

/**
 * フィードの 3 段 (設計書 §10)。段の判定はサーバー側 (`freshness`) に寄せてあるので、
 * ここは並んできたものを切り分けるだけ。上 2 段が空でも 3 段目が残り画面が空にならない
 */
function FeedTiers({ items }: { items: FeedItem[] }) {
  const t = useT();
  const lastSeenFeedAt = useFeedSeenBaseline(items.length > 0);

  if (items.length === 0) {
    return (
      <EmptyState
        title={t("home.feedEmptyTitle")}
        description={t("home.feedEmptyDescription")}
        action={
          <Link to="/following" className="text-sm underline underline-offset-4">
            {t("home.feedEmptyAction")}
          </Link>
        }
      />
    );
  }

  const upcoming = items.filter((item) => item.freshness === "upcoming");
  const recent = items.filter((item) => item.freshness === "recent");
  const older = items.filter((item) => item.freshness === "older");

  return (
    <div className="space-y-8">
      {upcoming.length > 0 ? (
        <FeedTier title={t("home.tierUpcoming")} items={upcoming} lastSeenFeedAt={lastSeenFeedAt} />
      ) : null}
      {recent.length > 0 ? (
        <FeedTier
          title={t("home.tierRecent", { days: FEED_RECENT_DAYS })}
          items={recent}
          lastSeenFeedAt={lastSeenFeedAt}
        />
      ) : null}
      {older.length > 0 ? (
        <CollapsibleTier
          title={t("home.tierOlder", { days: FEED_SINCE_DAYS })}
          items={older}
          lastSeenFeedAt={lastSeenFeedAt}
          // 上 2 段が空なら畳んだままでは画面が空に見える。そのときだけ開いて出す
          defaultOpen={upcoming.length === 0 && recent.length === 0}
        />
      ) : null}
    </div>
  );
}

function FeedTier({
  title,
  items,
  lastSeenFeedAt,
}: {
  title: string;
  items: FeedItem[];
  lastSeenFeedAt: string | null;
}) {
  const t = useT();
  return (
    <div className="space-y-3">
      <h2 className="font-medium text-lg">
        {title}
        <span className="ml-2 text-muted-foreground text-sm">
          {t("common.worksCount", { count: items.length })}
        </span>
      </h2>
      <FeedCards items={items} lastSeenFeedAt={lastSeenFeedAt} />
    </div>
  );
}

/** 3 段目は件数が多く、目的は「取りこぼしの確認」なので既定では畳んでおく */
function CollapsibleTier({
  title,
  items,
  lastSeenFeedAt,
  defaultOpen,
}: {
  title: string;
  items: FeedItem[];
  lastSeenFeedAt: string | null;
  defaultOpen: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="space-y-3">
      <h2 className="font-medium text-lg">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          title={open ? t("home.tierCollapse") : t("home.tierExpand")}
          className="inline-flex items-center gap-2 hover:underline"
        >
          {title}
          <span className="text-muted-foreground text-sm">
            {t("common.worksCount", { count: items.length })}
          </span>
          <span aria-hidden="true" className="text-muted-foreground text-sm">
            {open ? "▲" : "▼"}
          </span>
        </button>
      </h2>
      {open ? <FeedCards items={items} lastSeenFeedAt={lastSeenFeedAt} /> : null}
    </div>
  );
}

function FeedCards({
  items,
  lastSeenFeedAt,
}: {
  items: FeedItem[];
  lastSeenFeedAt: string | null;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <WorkCard
          key={item.work.id}
          item={item}
          actors={item.actors}
          unread={isUnreadSince(item.work, earliestFirstSeen(item.listings), lastSeenFeedAt)}
        />
      ))}
    </div>
  );
}

/** その作品をどのストアであれ最初に見つけた日時。未読判定の材料 */
function earliestFirstSeen(listings: FeedItem["listings"]): string | undefined {
  return listings
    .map((listing) => listing.firstSeenAt)
    .sort()
    .at(0);
}

/**
 * 今期アニメからの入口 (設計 `docs/feature-proposals/anime-season-entry-design-2026-09-18.md`)。
 *
 * 声優名を知らない利用者はここから入る。フォロー済みの利用者にも隠さないのは、
 * 「知らなかった出演」を見つける経路でもあるため
 */
function SeasonAnimeSection({
  season,
  anime,
}: {
  season: { seasonYear: number; season: AnimeSummary["season"] };
  anime: AnimeSummary[];
}) {
  const t = useT();
  const locale = useLocale();
  const slug = toSeasonSlug(season.seasonYear, season.season);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold text-xl tracking-tight">
          {t("home.seasonTitle", {
            season: seasonLabel(season.seasonYear, season.season, locale),
          })}
        </h2>
        <Link to="/anime/season/$season" params={{ season: slug }} className="text-sm underline">
          {t("home.seasonSeeAll", { count: anime.length })}
        </Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {anime.slice(0, SEASON_ANIME_LIMIT).map((item) => (
          <Link
            key={item.slug}
            to="/anime/$slug"
            params={{ slug: item.slug }}
            className="flex gap-3 rounded-xl border p-3 transition-colors hover:bg-accent"
          >
            {safeHttpsUrl(item.coverImageUrl) ? (
              <img
                src={safeHttpsUrl(item.coverImageUrl)}
                alt=""
                className="h-20 w-14 shrink-0 rounded-md object-cover"
                loading="lazy"
              />
            ) : null}
            <div className="min-w-0 space-y-1">
              <p className="font-medium leading-snug">{item.titleNative}</p>
              <p className="text-muted-foreground text-xs">
                {t("anime.actorCount", { count: item.actorCount })}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
