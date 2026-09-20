import { createFileRoute, notFound } from "@tanstack/react-router";
import { createTranslator } from "@/app/i18n";
import { actorDisplayName } from "@/app/lib/actor-name";
import { safeHttpsUrl } from "@/app/lib/safe-url";
import type { ActorDetail } from "@/app/lib/view-types";
import { VoiceActorPage } from "@/app/pages/voice-actor";
import { fetchActorBySlug } from "@/app/server-fns/actors";
import { fetchAnimeByActor } from "@/app/server-fns/anime";
import { siteOriginForLoader } from "@/app/server-fns/site";
import { fetchWorksByActor } from "@/app/server-fns/works";
import { STORE_SLUGS } from "@/domain/types";

/** 1 ストアあたりに出す作品数。新着を追うのが目的なので過去分は打ち切る */
const WORKS_PER_STORE = 30;

/**
 * 声優ページに出す出演アニメの上限。本人の識別 (「この人どのキャラの人だっけ」) が目的なので、
 * 全出演歴は並べない。並べるとアニメのキャスト DB になり、docs/product.md の「作らないもの」の線を越える
 */
const ANIME_PER_ACTOR = 8;

/** 声優ページ。画面は `@/app/pages/voice-actor` */
export const Route = createFileRoute("/voice-actors/$slug")({
  loader: async ({ params }) => {
    // canonical を絶対 URL にするためのオリジン。head() からは読めないのでここで解決する
    const [actor, origin] = await Promise.all([
      fetchActorBySlug({ data: { slug: params.slug } }),
      siteOriginForLoader(),
    ]);
    if (!actor) throw notFound();

    // ストアごとにセクションを出すので、ストアごとに引く (片方が 0 件でもセクションは出す)
    const works = await Promise.all(
      STORE_SLUGS.map(async (storeSlug) => ({
        storeSlug,
        items: await fetchWorksByActor({
          data: { voiceActorId: actor.id, storeSlug, limit: WORKS_PER_STORE },
        }),
      })),
    );

    // 追跡対象は AniList 由来の 2,500 人規模。DB にはクロール履歴を残すために全員入れるが、
    // その大半は音声作品を出していない。中身の無いページを 200 で返すと、検索エンジンから見て
    // 薄いページが 2,000 枚並ぶことになるので、作品が 1 件も無い声優は 404 にする。
    // 声優そのものは `getActorBySlug` が返し続ける (管理用)
    if (works.every((section) => section.items.length === 0)) throw notFound();

    // 出演アニメは 404 の判定の後に引く。音声作品が無ければページ自体を出さないので、
    // 先に引いても捨てることになる
    const anime = await fetchAnimeByActor({
      data: { voiceActorId: actor.id, limit: ANIME_PER_ACTOR },
    });

    return { actor, works, anime, origin };
  },
  head: ({ loaderData, params, match }) => {
    const actor = loaderData?.actor;
    if (!actor) return {};

    const locale = match.context.locale;
    const t = createTranslator(locale);
    // 声優名はデータそのもの。訳さず、英語表示で name_en があればそちらを出す
    const name = actorDisplayName(actor, locale);
    const title = t("actor.metaTitle", { name });
    const description = t("actor.metaDescription", { name });
    const canonical = absoluteUrl(loaderData?.origin, `/voice-actors/${params.slug}`);

    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "profile" },
        { property: "og:url", content: canonical },
      ],
      links: [{ rel: "canonical", href: canonical }],
      scripts: [
        {
          type: "application/ld+json",
          children: toJsonLdScript(personJsonLd(actor, canonical)),
        },
      ],
    };
  },
  component: RouteComponent,
});

/**
 * 検索エンジンに「この URL は人物のページ」と伝える (実体クエリでの流入狙い)。
 * name は表示言語に関わらず canonicalName のまま。構造化データは実体の正規表記を出す場所で、
 * 画面の表示言語で揺らすものではない
 */
function personJsonLd(actor: ActorDetail, url: string) {
  const alternateName = actor.aliases.map((alias) => alias.name);
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    name: actor.canonicalName,
    url,
    ...(actor.nameKana ? { additionalName: actor.nameKana } : {}),
    ...(alternateName.length > 0 ? { alternateName } : {}),
    ...(actor.imageUrl ? { image: safeHttpsUrl(actor.imageUrl) } : {}),
  };
}

/**
 * JSON-LD を `<script>` の中身として安全な文字列にする。
 *
 * 中身は声優名・別名という外部由来の文字列で、`JSON.stringify` は `<` をそのまま残す。
 * `</script>` が含まれるとそこでスクリプト要素が閉じ、後続が HTML として解釈される。
 * `<` を `<` に置き換えれば JSON としての意味は変わらないまま閉じられなくなる
 */
function toJsonLdScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/** オリジンが取れていれば絶対 URL、取れていなければ相対パスのまま出す */
function absoluteUrl(origin: string | undefined, path: string): string {
  return origin ? `${origin}${path}` : path;
}

function RouteComponent() {
  const { actor, works, anime } = Route.useLoaderData();
  return <VoiceActorPage actor={actor} works={works} anime={anime} />;
}
