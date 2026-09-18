import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ActorSearch } from "@/app/components/actor-search";
import { EmptyState } from "@/app/components/empty-state";
import { Badge } from "@/app/components/ui/badge";
import { WorkCard } from "@/app/components/work-card";
import { isUnreadSince } from "@/app/lib/format";
import type { ActorSummary, FeedItem } from "@/app/lib/view-types";
import { fetchAllActors } from "@/app/server-fns/actors";
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

/**
 * トップ (企画書 §13)。
 *
 * SSR で出すのは検索欄・全声優の新着・声優一覧まで。フォローはブラウザ内にしか無いので、
 * 「フォロー中の新着」はマウント後にフォロー ID を読んでから server function で取りに行く
 */
export const Route = createFileRoute("/")({
  loader: async () => {
    const [latest, actors] = await Promise.all([
      fetchLatestWorks({ data: { sinceDays: LATEST_SINCE_DAYS, limit: LATEST_LIMIT } }),
      fetchAllActors(),
    ]);
    return { latest, actors };
  },
  component: HomePage,
});

function HomePage() {
  const { latest, actors } = Route.useLoaderData();
  const follows = useFollowStore((state) => state.follows);
  const status = useFollowStore((state) => state.status);

  return (
    <div className="space-y-10">
      <ActorSearch />

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
  return (
    <p className="rounded-xl border bg-muted/40 px-4 py-3 text-sm">
      好きな声優をフォローすると、ここが DLsite と Audible
      を横断した「フォロー中の新着」に変わる。アカウント登録は不要で、フォローはこのブラウザにだけ保存される。
    </p>
  );
}

function LatestSection({ latest }: { latest: Awaited<ReturnType<typeof fetchLatestWorks>> }) {
  return (
    <section className="space-y-4">
      <h1 className="font-semibold text-2xl tracking-tight">最近の新着 (全声優)</h1>
      {latest.length === 0 ? (
        <EmptyState
          title="まだ新着がありません"
          description="クローラーが作品を集めるとここに並ぶ。"
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
  if (actors.length === 0) return null;
  return (
    <section className="space-y-4">
      <h2 className="font-semibold text-xl tracking-tight">声優一覧</h2>
      <ul className="flex flex-wrap gap-2">
        {actors.map((actor) => (
          <li key={actor.id}>
            <Link
              to="/voice-actors/$slug"
              params={{ slug: actor.slug }}
              className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
            >
              {actor.canonicalName}
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
      <h1 className="font-semibold text-2xl tracking-tight">フォロー中の新着</h1>
      <p className="text-muted-foreground text-sm">
        フォロー中 {follows.length} 人の、発売日が直近 {FEED_SINCE_DAYS} 日 / 発売予定の音声作品。
      </p>

      {state.phase === "loading" ? (
        <p className="text-muted-foreground text-sm">読み込み中…</p>
      ) : null}
      {state.phase === "error" ? (
        <EmptyState
          title="新着を取得できませんでした"
          description="時間をおいて再読み込みすること。"
        />
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

/** 3 段の見出し。サーバーが付けてくる `freshness` と 1 対 1 で対応する */
const TIER_TITLES = {
  upcoming: "今後の発売",
  recent: `${FEED_RECENT_DAYS} 日以内の新作`,
  older: `それ以前 (直近 ${FEED_SINCE_DAYS} 日)`,
} as const;

/**
 * フィードの 3 段 (設計書 §10)。段の判定はサーバー側 (`freshness`) に寄せてあるので、
 * ここは並んできたものを切り分けるだけ。上 2 段が空でも 3 段目が残り画面が空にならない
 */
function FeedTiers({ items }: { items: FeedItem[] }) {
  const lastSeenFeedAt = useFeedSeenBaseline(items.length > 0);

  if (items.length === 0) {
    return (
      <EmptyState
        title="この期間の新着はありません"
        description="フォローを増やすか、時間をおいて見ること。"
        action={
          <Link to="/following" className="text-sm underline underline-offset-4">
            フォロー中の声優を見る
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
        <FeedTier title={TIER_TITLES.upcoming} items={upcoming} lastSeenFeedAt={lastSeenFeedAt} />
      ) : null}
      {recent.length > 0 ? (
        <FeedTier title={TIER_TITLES.recent} items={recent} lastSeenFeedAt={lastSeenFeedAt} />
      ) : null}
      {older.length > 0 ? (
        <CollapsibleTier
          title={TIER_TITLES.older}
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
  return (
    <div className="space-y-3">
      <h2 className="font-medium text-lg">
        {title}
        <span className="ml-2 text-muted-foreground text-sm">{items.length} 作品</span>
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
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="space-y-3">
      <h2 className="font-medium text-lg">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="inline-flex items-center gap-2 hover:underline"
        >
          {title}
          <span className="text-muted-foreground text-sm">{items.length} 作品</span>
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
