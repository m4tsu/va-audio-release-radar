import { Link } from "@tanstack/react-router";
import { EmptyState } from "@/app/components/empty-state";
import { FollowButton } from "@/app/components/follow-button";
import { PageHeader } from "@/app/components/page-header";
import { storeLabel } from "@/app/components/store-badge";
import { WorkCard } from "@/app/components/work-card";
import { useLocale, useT } from "@/app/i18n";
import { actorDisplayName } from "@/app/lib/actor-name";
import { animeDisplayTitle } from "@/app/lib/anime-title";
import { characterDisplayName } from "@/app/lib/character-name";
import { safeHttpsUrl } from "@/app/lib/safe-url";
import { seasonLabel } from "@/app/lib/season";
import type { ActorAnimeAppearance, ActorDetail, WorkWithListings } from "@/app/lib/view-types";
import type { StoreSlug } from "@/domain/types";

export type ActorStoreWorks = { storeSlug: StoreSlug; items: WorkWithListings[] };

/**
 * 声優ページ。「{声優名} ASMR」「{声優名} Audible」のような
 * 実体検索での流入を受ける想定なので、中身は全部 SSR で出しインデックスさせる。
 *
 * クライアントでしか決まらないのはフォローボタンの状態だけ
 */
export function VoiceActorPage({
  actor,
  works,
  anime,
}: {
  actor: ActorDetail;
  works: ActorStoreWorks[];
  anime: ActorAnimeAppearance[];
}) {
  const t = useT();
  const locale = useLocale();
  const name = actorDisplayName(actor, locale);

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("actor.title", { name })}
        description={actor.nameKana ?? undefined}
        actions={
          <FollowButton
            size="default"
            actor={{
              voiceActorId: actor.id,
              slug: actor.slug,
              canonicalName: actor.canonicalName,
              ...(actor.nameEn ? { nameEn: actor.nameEn } : {}),
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
        <EmptyState title={t("actor.storeEmptyTitle", { store: storeLabel(storeSlug) })} />
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
 * あらすじも話数も持たない (docs/product.md の「作らないもの」)
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
              <p className="font-medium leading-snug">{animeDisplayTitle(item, locale)}</p>
              <p className="text-muted-foreground text-xs">
                {/* 作品名も役名も AniList 由来のデータ。訳さず、表示言語に合う表記を選ぶだけ */}
                {[
                  characterDisplayName(item, locale),
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
