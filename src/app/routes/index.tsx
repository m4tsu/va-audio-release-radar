import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ActorSearch } from "@/app/components/actor-search";
import { EmptyState } from "@/app/components/empty-state";
import { Badge } from "@/app/components/ui/badge";
import { WorkCard } from "@/app/components/work-card";
import type { ActorSummary, FeedItem } from "@/app/lib/view-types";
import { fetchAllActors } from "@/app/server-fns/actors";
import { fetchFeed, fetchLatestWorks } from "@/app/server-fns/works";
import { useFollowStore } from "@/app/store/follow-store";

/** 新着として扱う期間 (企画書 §5 の「new release radar」)。過去の在庫は見せない */
const FEED_SINCE_DAYS = 30;
const FEED_LIMIT = 60;
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
      fetchLatestWorks({ data: { sinceDays: FEED_SINCE_DAYS, limit: LATEST_LIMIT } }),
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
        フォロー中 {follows.length} 人の、直近 {FEED_SINCE_DAYS} 日の音声作品。
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
      {state.phase === "ready" ? <FeedGroups items={state.items} /> : null}
    </section>
  );
}

/**
 * 声優ごとにまとめて出す。1 つの作品に複数のフォロー中声優が出ていれば、
 * その人数ぶん見出しの下に現れる (誰の新着として見たいかは読み手によるため)
 */
function FeedGroups({ items }: { items: FeedItem[] }) {
  const groups = groupByActor(items);

  if (groups.length === 0) {
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

  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <div key={group.actor.id} className="space-y-3">
          <h2 className="font-medium text-lg">
            <Link
              to="/voice-actors/$slug"
              params={{ slug: group.actor.slug }}
              className="hover:underline"
            >
              {group.actor.name}
            </Link>
            <span className="ml-2 text-muted-foreground text-sm">{group.items.length} 作品</span>
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {group.items.map((item) => (
              <WorkCard key={item.work.id} item={item} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

type FeedGroup = {
  actor: { id: string; slug: string; name: string };
  items: FeedItem[];
};

/** 声優ごとのまとまり。フィード自体が新しい順なので、各声優の最新作が早い順に並ぶ */
function groupByActor(items: FeedItem[]): FeedGroup[] {
  const groups = new Map<string, FeedGroup>();
  for (const item of items) {
    for (const actor of item.actors) {
      const group = groups.get(actor.id);
      if (group) group.items.push(item);
      else groups.set(actor.id, { actor, items: [item] });
    }
  }
  return [...groups.values()];
}
