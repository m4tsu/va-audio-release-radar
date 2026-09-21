import { Link } from "@tanstack/react-router";
import { ListFilter } from "lucide-react";
import { EmptyState } from "@/app/components/empty-state";
import { FollowButton } from "@/app/components/follow-button";
import { PageHeader } from "@/app/components/page-header";
import { storeLabel } from "@/app/components/store-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { WorkCard } from "@/app/components/work-card";
import { useLocale, useT } from "@/app/i18n";
import { actorDisplayName } from "@/app/lib/actor-name";
import { animeDisplayTitle } from "@/app/lib/anime-title";
import {
  APPEARANCE_FILTERS,
  type AppearanceFilter,
  appearanceLabel,
  isAppearanceFilter,
  matchesAppearance,
} from "@/app/lib/appearance";
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
 * クライアントでしか決まらないのはフォローボタンの状態だけ。出演形態の絞り込みは
 * URL の検索文字列に置く (ルートが読む)。ページ内の状態にすると、絞った画面を
 * 共有も再読み込みもできず、SSR が返す HTML と食い違う
 */
export function VoiceActorPage({
  actor,
  works,
  anime,
  appearance,
  onAppearanceChange,
}: {
  actor: ActorDetail;
  works: ActorStoreWorks[];
  anime: ActorAnimeAppearance[];
  /** 出演形態の絞り込み。URL から来る */
  appearance: AppearanceFilter;
  onAppearanceChange: (next: AppearanceFilter) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const name = actorDisplayName(actor, locale);
  // 絞り込むのはルートが取ってきた範囲の中だけ。1 ストアの件数には上限があり
  // (`routes/voice-actors.$slug.tsx`)、その先にある該当作品は出ない。
  // 上限は新着を追うための打ち切りなので、絞り込みのたびに動かさない
  const sections = works.map((section) => ({
    storeSlug: section.storeSlug,
    items: section.items.filter((item) => matchesAppearance(appearance, item.castSize)),
    // 0 件の理由。絞り込みで消えたのか、そのストアに元から無いのかで言い方が変わる
    emptiedByFilter: appearance !== "all" && section.items.length > 0,
  }));

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

      <AppearanceFilterSelect value={appearance} onChange={onAppearanceChange} />

      {sections.map((section) => (
        <StoreSection
          key={section.storeSlug}
          storeSlug={section.storeSlug}
          items={section.items}
          emptiedByFilter={section.emptiedByFilter}
        />
      ))}

      {anime.length > 0 ? <AnimeSection items={anime} /> : null}
    </div>
  );
}

/**
 * 出演形態の絞り込み。選べるのは人数から確実に決まる区分だけで、「不明」は選べない
 * (`@/app/lib/appearance`)。ネイティブの `<select>` を使わない理由は `locale-select.tsx` と同じ
 */
function AppearanceFilterSelect({
  value,
  onChange,
}: {
  value: AppearanceFilter;
  onChange: (next: AppearanceFilter) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const label = (option: AppearanceFilter) =>
    option === "all" ? t("appearance.filterAll") : appearanceLabel(option, locale);

  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (isAppearanceFilter(next)) onChange(next);
      }}
    >
      <SelectTrigger size="sm" aria-label={t("appearance.filterLabel", { name: label(value) })}>
        <ListFilter aria-hidden="true" />
        {/* Radix は選ばれた項目の文言を SelectItem から流し込む。開くまで項目が描かれず
            SSR では空のまま返るので、文言をここで直接渡す */}
        <SelectValue>{label(value)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {APPEARANCE_FILTERS.map((option) => (
          <SelectItem key={option} value={option}>
            {label(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function StoreSection({
  storeSlug,
  items,
  emptiedByFilter,
}: {
  storeSlug: StoreSlug;
  items: WorkWithListings[];
  /** 0 件なのが絞り込みのせいか。そのストアに元から作品が無いときと言い方を変える */
  emptiedByFilter: boolean;
}) {
  const t = useT();
  return (
    <section className="space-y-3">
      <h2 className="font-semibold text-xl tracking-tight">{storeLabel(storeSlug)}</h2>
      {items.length === 0 ? (
        <EmptyState
          title={
            emptiedByFilter
              ? t("actor.filteredEmptyTitle", { store: storeLabel(storeSlug) })
              : t("actor.storeEmptyTitle", { store: storeLabel(storeSlug) })
          }
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
