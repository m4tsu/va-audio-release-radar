import { createFileRoute } from "@tanstack/react-router";
import { createTranslator } from "@/app/i18n";
import { FollowingPage } from "@/app/pages/following";

/** フォロー中の声優の音声作品。画面は `@/app/pages/following` */
export const Route = createFileRoute("/following")({
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
  component: FollowingPage,
});
