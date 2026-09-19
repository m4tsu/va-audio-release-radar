import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { EmptyState } from "@/app/components/empty-state";
import { FollowButton } from "@/app/components/follow-button";
import { PageHeader } from "@/app/components/page-header";
import { storeLabel } from "@/app/components/store-badge";
import { WorkCard } from "@/app/components/work-card";
import { createTranslator, useLocale, useT } from "@/app/i18n";
import { actorDisplayName } from "@/app/lib/actor-name";
import { safeHttpsUrl } from "@/app/lib/safe-url";
import { seasonLabel } from "@/app/lib/season";
import type { ActorAnimeAppearance, ActorDetail, WorkWithListings } from "@/app/lib/view-types";
import { fetchActorBySlug } from "@/app/server-fns/actors";
import { fetchAnimeByActor } from "@/app/server-fns/anime";
import { siteOriginForLoader } from "@/app/server-fns/site";
import { fetchWorksByActor } from "@/app/server-fns/works";
import { STORE_SLUGS, type StoreSlug } from "@/domain/types";

/** 1 ストアあたりに出す作品数。新着を追うのが目的なので過去分は打ち切る (企画書 §5) */
const WORKS_PER_STORE = 30;

/**
 * 声優ページに出す出演アニメの上限。本人の識別 (「この人どのキャラの人だっけ」) が目的なので、
 * 全出演歴は並べない。並べるとアニメのキャスト DB になり、設計書 §1 の線を越える
 */
const ANIME_PER_ACTOR = 8;

/**
 * 声優ページ (企画書 §13)。「{声優名} ASMR」「{声優名} Audible」のような
 * 実体検索での流入を受ける想定なので、中身は全部 SSR で出しインデックスさせる (企画書 §14)。
 *
 * クライアントでしか決まらないのはフォローボタンの状態だけ
 */
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

    // 追跡対象は AniList 由来の 2,500 人規模 (T13)。DB にはクロール履歴を残すために全員入れるが、
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
  component: VoiceActorPage,
});

/**
 * 検索エンジンに「この URL は人物のページ」と伝える (企画書 §14 の実体クエリ狙い)。
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
 * `<` を `\u003c` に置き換えれば JSON としての意味は変わらないまま閉じられなくなる
 */
function toJsonLdScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/** オリジンが取れていれば絶対 URL、取れていなければ相対パスのまま出す */
function absoluteUrl(origin: string | undefined, path: string): string {
  return origin ? `${origin}${path}` : path;
}

function VoiceActorPage() {
  const t = useT();
  const locale = useLocale();
  const { actor, works, anime } = Route.useLoaderData();
  const name = actorDisplayName(actor, locale);

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("actor.title", { name })}
        description={
          actor.nameKana
            ? t("actor.subtitleWithKana", { kana: actor.nameKana })
            : t("actor.subtitle")
        }
        actions={
          <FollowButton
            size="default"
            actor={{
              voiceActorId: actor.id,
              slug: actor.slug,
              canonicalName: actor.canonicalName,
            }}
          />
        }
      />

      {works.map((section) => (
        <StoreSection key={section.storeSlug} storeSlug={section.storeSlug} items={section.items} />
      ))}

      {anime.length > 0 ? <AnimeSection items={anime} /> : null}
    </div>
  );
}

function StoreSection({ storeSlug, items }: { storeSlug: StoreSlug; items: WorkWithListings[] }) {
  const t = useT();
  return (
    <section className="space-y-3">
      <h2 className="font-semibold text-xl tracking-tight">{storeLabel(storeSlug)}</h2>
      {items.length === 0 ? (
        <EmptyState
          title={t("actor.storeEmptyTitle")}
          description={t("actor.storeEmptyDescription", { store: storeLabel(storeSlug) })}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((item) => (
            <WorkCard key={item.work.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * 出演アニメ。本人を特定するための手がかりとして出すので、役名と作品名だけに留める。
 * あらすじも話数も持たない (設計書 §1 の「アニメのキャスト DB ではない」)
 */
function AnimeSection({ items }: { items: ActorAnimeAppearance[] }) {
  const t = useT();
  const locale = useLocale();
  return (
    <section className="space-y-3">
      <h2 className="font-semibold text-xl tracking-tight">{t("actor.animeTitle")}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <Link
            key={`${item.slug}-${item.characterNameNative}`}
            to="/anime/$slug"
            params={{ slug: item.slug }}
            className="flex gap-3 rounded-xl border p-3 transition-colors hover:bg-accent"
          >
            {safeHttpsUrl(item.characterImageUrl) ? (
              <img
                src={safeHttpsUrl(item.characterImageUrl)}
                alt=""
                className="h-16 w-12 shrink-0 rounded-md object-cover"
                loading="lazy"
              />
            ) : null}
            <div className="min-w-0 space-y-1">
              <p className="font-medium leading-snug">{item.titleNative}</p>
              <p className="text-muted-foreground text-xs">
                {/* 役名は AniList 由来のデータなので訳さない */}
                {[
                  item.characterNameNative,
                  item.role === "main" ? t("anime.roleMain") : t("anime.roleSupporting"),
                  seasonLabel(item.seasonYear, item.season, locale),
                ].join(t("common.slashSeparator"))}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
