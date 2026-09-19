import { Check, Plus } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { useT } from "@/app/i18n";
import { type FollowTarget, useFollowStore, useIsFollowing } from "@/app/store/follow-store";

/**
 * 声優のフォロー / 解除。ユーザーに求める操作はこれとストアへ行くことだけ。
 *
 * フォロー状態はブラウザ内にしか無いので SSR 時は必ず「未フォロー」で描かれる。
 * 読み込みが済むまで (`status !== "ready"`) は押せなくしておく。押せてしまうと、
 * 直後に届いた保存済みの状態で操作が上書きされて消えたように見えるため
 */
export function FollowButton({
  actor,
  size = "sm",
  className,
}: {
  actor: FollowTarget;
  size?: "sm" | "default";
  className?: string;
}) {
  const t = useT();
  const status = useFollowStore((state) => state.status);
  const follow = useFollowStore((state) => state.follow);
  const unfollow = useFollowStore((state) => state.unfollow);
  const following = useIsFollowing(actor.voiceActorId);

  return (
    <Button
      type="button"
      size={size}
      variant={following ? "outline" : "default"}
      disabled={status !== "ready"}
      aria-pressed={following}
      className={className}
      onClick={() => {
        if (following) void unfollow(actor.voiceActorId);
        else void follow(actor);
      }}
    >
      {following ? <Check aria-hidden="true" /> : <Plus aria-hidden="true" />}
      {following ? t("follow.following") : t("follow.follow")}
    </Button>
  );
}
