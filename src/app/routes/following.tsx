import { createFileRoute, Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { EmptyState } from "@/app/components/empty-state";
import { PageHeader } from "@/app/components/page-header";
import { Button } from "@/app/components/ui/button";
import { useFollowStore } from "@/app/store/follow-store";

/**
 * フォロー中の声優一覧 (企画書 §13)。
 *
 * フォローはブラウザ内 (IndexedDB) にしか無いので、SSR では枠だけを返し、
 * 中身はマウント後に描く。読み込み前を「0 件」と見せないよう status で分ける
 */
export const Route = createFileRoute("/following")({
  head: () => ({
    meta: [
      { title: "フォロー中の声優 | Voice Actor Audio Release Radar" },
      // フォローはブラウザごとに違う。検索結果に出しても意味が無い
      { name: "robots", content: "noindex" },
    ],
  }),
  component: FollowingPage,
});

function FollowingPage() {
  const follows = useFollowStore((state) => state.follows);
  const status = useFollowStore((state) => state.status);
  const unfollow = useFollowStore((state) => state.unfollow);

  return (
    <div>
      <PageHeader
        title="フォロー中"
        description="フォローはこのブラウザにだけ保存される。別の端末には引き継がれない。"
      />

      {status !== "ready" ? <p className="text-muted-foreground text-sm">読み込み中…</p> : null}

      {status === "ready" && follows.length === 0 ? (
        <EmptyState
          title="まだ誰もフォローしていません"
          description="トップの検索から声優を探してフォローすると、ここと新着フィードに並ぶ。"
          action={
            <Button asChild>
              <Link to="/">声優を探す</Link>
            </Button>
          }
        />
      ) : null}

      {status === "ready" && follows.length > 0 ? (
        <ul aria-label="フォロー中の声優" className="divide-y rounded-xl border bg-card">
          {follows.map((actor) => (
            <li
              key={actor.voiceActorId}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <Link
                to="/voice-actors/$slug"
                params={{ slug: actor.slug }}
                className="min-w-0 font-medium hover:underline"
              >
                {actor.canonicalName}
              </Link>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void unfollow(actor.voiceActorId)}
              >
                <X aria-hidden="true" />
                フォロー解除
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
