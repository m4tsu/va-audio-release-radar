import { createFileRoute, notFound } from "@tanstack/react-router";
import { EmptyState } from "@/app/components/empty-state";
import { FollowButton } from "@/app/components/follow-button";
import { PageHeader } from "@/app/components/page-header";
import { storeLabel } from "@/app/components/store-badge";
import { WorkCard } from "@/app/components/work-card";
import { safeHttpsUrl } from "@/app/lib/safe-url";
import type { ActorDetail, WorkWithListings } from "@/app/lib/view-types";
import { fetchActorBySlug } from "@/app/server-fns/actors";
import { siteOriginForLoader } from "@/app/server-fns/site";
import { fetchWorksByActor } from "@/app/server-fns/works";
import { STORE_SLUGS } from "@/domain/types";

/** 1 ストアあたりに出す作品数。新着を追うのが目的なので過去分は打ち切る (企画書 §5) */
const WORKS_PER_STORE = 30;

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

    return { actor, works, origin };
  },
  head: ({ loaderData, params }) => {
    const actor = loaderData?.actor;
    if (!actor) return {};

    const title = `${actor.canonicalName}の新着音声作品 | DLsite・Audible`;
    const description = `${actor.canonicalName}が出演する DLsite の ASMR・ボイス作品と Audible の朗読を新着順に。`;
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

/** 検索エンジンに「この URL は人物のページ」と伝える (企画書 §14 の実体クエリ狙い) */
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
  const { actor, works } = Route.useLoaderData();

  return (
    <div className="space-y-8">
      <PageHeader
        title={`${actor.canonicalName}の新着音声作品`}
        description={
          actor.nameKana ? (
            <>{actor.nameKana} ／ DLsite・Audible を横断した新着順</>
          ) : (
            "DLsite・Audible を横断した新着順"
          )
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
    </div>
  );
}

function StoreSection({
  storeSlug,
  items,
}: {
  storeSlug: "dlsite" | "audible";
  items: WorkWithListings[];
}) {
  return (
    <section className="space-y-3">
      <h2 className="font-semibold text-xl tracking-tight">{storeLabel(storeSlug)}</h2>
      {items.length === 0 ? (
        <EmptyState
          title="まだ見つかっていません"
          description={`${storeLabel(storeSlug)} でのこの声優の作品は、まだ収集できていない。`}
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
