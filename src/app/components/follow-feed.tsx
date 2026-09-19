import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { EmptyState } from "@/app/components/empty-state";
import { WorkCard } from "@/app/components/work-card";
import { useT } from "@/app/i18n";
import { isUnreadSince } from "@/app/lib/format";
import type { FeedItem } from "@/app/lib/view-types";
import { fetchFeed } from "@/app/server-fns/works";
import { useFollowStore } from "@/app/store/follow-store";

/**
 * フィードが遡る期間。3 段目「それ以前」の下限でもある。
 * 段分け (今後の発売 / 30 日以内 / それ以前) はサーバーが `freshness` として付けてくる
 */
export const FEED_SINCE_DAYS = 90;
/**
 * 2 段目の見出しに出す日数。判定そのものはサーバー (`RECENT_DAYS`) が持っているので、
 * ここは表示用の写し。サーバーはクライアントから import できない (D1 に触るため)
 */
const FEED_RECENT_DAYS = 30;
const FEED_LIMIT = 60;

type FeedState = { phase: "loading" } | { phase: "ready"; items: FeedItem[] } | { phase: "error" };

/**
 * フォロー中の声優の新着。
 *
 * フォロー ID はサーバーが知らないので、毎回まとめて送って引き直す。
 * フォローの増減でキーが変わったときだけ取り直す
 */
export function FollowFeed() {
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

  if (state.phase === "loading") {
    return <p className="text-muted-foreground text-sm">{t("common.loading")}</p>;
  }
  if (state.phase === "error") {
    return (
      <EmptyState title={t("following.errorTitle")} description={t("following.errorDescription")} />
    );
  }
  return <FeedTiers items={state.items} />;
}

/**
 * 未読の基準になる「前回フィードを見た日時」。
 *
 * 描画に使うのは更新前の値。先に保存してしまうと、開いた瞬間に全件が既読になって
 * 印が一度も出ない。初回 (null) は印を出さずに今の時刻だけ保存する
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
 * フィードの 3 段。段の判定はサーバー側 (`freshness`) に寄せてあるので、
 * ここは並んできたものを切り分けるだけ。上 2 段が空でも 3 段目が残り画面が空にならない
 */
function FeedTiers({ items }: { items: FeedItem[] }) {
  const t = useT();
  const lastSeenFeedAt = useFeedSeenBaseline(items.length > 0);

  if (items.length === 0) {
    return (
      <EmptyState
        title={t("following.feedEmptyTitle")}
        action={
          <Link to="/voice-actors" className="text-sm underline underline-offset-4">
            {t("following.feedEmptyAction")}
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
        <FeedTier
          title={t("following.tierUpcoming")}
          items={upcoming}
          lastSeenFeedAt={lastSeenFeedAt}
        />
      ) : null}
      {recent.length > 0 ? (
        <FeedTier
          title={t("following.tierRecent", { days: FEED_RECENT_DAYS })}
          items={recent}
          lastSeenFeedAt={lastSeenFeedAt}
        />
      ) : null}
      {older.length > 0 ? (
        <CollapsibleTier
          title={t("following.tierOlder", { days: FEED_SINCE_DAYS })}
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
          title={open ? t("following.tierCollapse") : t("following.tierExpand")}
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
