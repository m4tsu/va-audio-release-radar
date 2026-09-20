import { createFileRoute } from "@tanstack/react-router";
import { createTranslator } from "@/app/i18n";
import { VoiceActorDirectoryPage } from "@/app/pages/voice-actor-directory";
import { fetchAllActors } from "@/app/server-fns/actors";
import { siteOriginForLoader } from "@/app/server-fns/site";

/** 声優の一覧。画面は `@/app/pages/voice-actor-directory` */
export const Route = createFileRoute("/voice-actors/")({
  loader: async () => {
    const [actors, origin] = await Promise.all([fetchAllActors(), siteOriginForLoader()]);
    return { actors, origin };
  },
  head: ({ loaderData, match }) => {
    const t = createTranslator(match.context.locale);
    const title = t("voiceActors.metaTitle", { app: t("app.name") });
    const description = t("voiceActors.metaDescription");
    const canonical = loaderData?.origin ? `${loaderData.origin}/voice-actors` : "/voice-actors";

    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:url", content: canonical },
      ],
      links: [{ rel: "canonical", href: canonical }],
    };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { actors } = Route.useLoaderData();
  return <VoiceActorDirectoryPage actors={actors} />;
}
