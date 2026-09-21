import { createFileRoute } from "@tanstack/react-router";
import { createTranslator } from "@/app/i18n";
import { FollowingPage } from "@/app/pages/following";
import { fetchPushConfig } from "@/app/server-fns/push";

/** フォロー中の声優の音声作品。画面は `@/app/pages/following` */
export const Route = createFileRoute("/following")({
  // 通知の公開鍵は設定 (`vars.VAPID_PUBLIC_KEY`) で、ブラウザからは server function でしか読めない
  loader: async () => {
    const { vapidPublicKey } = await fetchPushConfig();
    return { vapidPublicKey };
  },
  head: ({ match }) => {
    const t = createTranslator(match.context.locale);
    return {
      meta: [
        { title: t("following.metaTitle", { app: t("app.name") }) },
        // フォローはブラウザごとに違う。検索結果に出しても意味が無い
        { name: "robots", content: "noindex" },
      ],
    };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { vapidPublicKey } = Route.useLoaderData();
  return <FollowingPage vapidPublicKey={vapidPublicKey} />;
}
