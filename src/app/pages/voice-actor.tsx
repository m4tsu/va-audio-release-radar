import { Link } from "@tanstack/react-router";
import { ExternalLink, ListFilter } from "lucide-react";
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
import { storeActorSearchUrl } from "@/app/lib/store-search";
import type {
  ActorAnimeAppearance,
  ActorDetail,
  ActorStoreCoverage,
  WorkWithListings,
} from "@/app/lib/view-types";
import type { StoreSlug } from "@/domain/types";

export type ActorStoreWorks = { storeSlug: StoreSlug; items: WorkWithListings[] };

/**
 * どのストアにも作品が無いか。ルートはこれを見て `robots` の指定を決めるので、
 * 画面とルートで判定がずれないようここから出す
 */
export function hasAnyWork(works: readonly ActorStoreWorks[]): boolean {
  return works.some((section) => section.items.length > 0);
}

/**
 * 声優ページ。「{声優名} ASMR」「{声優名} Audible」のような
 * 実体検索での流入を受ける想定なので、中身は全部 SSR で出しインデックスさせる。
 *
 * 音声作品がまだ 1 件も無い声優のページも出す。「初めての 1 本」を待つ人のフォローを
 * 受けるためで、そのときはストアごとのセクションではなく、まだ見つかっていないことを 1 つ出す
 * (`docs/decisions/0012-follow-actors-without-works.md`)。
 *
 * クライアントでしか決まらないのはフォローボタンの状態だけ。出演形態の絞り込みは
 * URL の検索文字列に置く (ルートが読む)。ページ内の状態にすると、絞った画面を
 * 共有も再読み込みもできず、SSR が返す HTML と食い違う
 */
export function VoiceActorPage({
  actor,
  works,
  anime,
  coverage,
  appearance,
  onAppearanceChange,
}: {
  actor: ActorDetail;
  works: ActorStoreWorks[];
  anime: ActorAnimeAppearance[];
  /** ストアごとの網羅の状態。走行の記録が無いストアは入っていない */
  coverage: ActorStoreCoverage[];
  /** 出演形態の絞り込み。URL から来る */
  appearance: AppearanceFilter;
  onAppearanceChange: (next: AppearanceFilter) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const name = actorDisplayName(actor, locale);
  const anyWork = hasAnyWork(works);
  // 絞り込むのはルートが取ってきた範囲の中だけ。1 ストアの件数には上限があり
  // (`routes/voice-actors.$slug.tsx`)、その先にある該当作品は出ない。
  // 上限は新着を追うための打ち切りなので、絞り込みのたびに動かさない

  // 取り切れていないストア。取り切れたストアと、走行の記録が無いストアは入らない
  const partialStores = new Set(
    coverage.filter((entry) => !entry.complete).map((entry) => entry.storeSlug),
  );

  const sections = works.map((section) => ({
    storeSlug: section.storeSlug,
    items: section.items.filter((item) => matchesAppearance(appearance, item.castSize)),
    // 0 件の理由。絞り込みで消えたのか、そのストアに元から無いのかで言い方が変わる
    emptiedByFilter: appearance !== "all" && section.items.length > 0,
    partial: partialStores.has(section.storeSlug),
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

      {anyWork ? (
        <>
          <AppearanceFilterSelect value={appearance} onChange={onAppearanceChange} />

          {sections.map((section) => (
            <StoreSection
              key={section.storeSlug}
              storeSlug={section.storeSlug}
              items={section.items}
              emptiedByFilter={section.emptiedByFilter}
              partial={section.partial}
              actor={actor}
            />
          ))}
        </>
      ) : (
        // ストアごとに「ありません」を 3 つ並べても、1 件も無いことは同じだけ伝わって
        // 読む量だけ増える。出演形態の絞り込みも選べる中身が無いので出さない
        <EmptyState
          title={t("actor.noWorksYetTitle")}
          description={t("actor.noWorksYetDescription")}
        />
      )}

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
  partial,
  actor,
}: {
  storeSlug: StoreSlug;
  items: WorkWithListings[];
  /** 0 件なのが絞り込みのせいか。そのストアに元から作品が無いときと言い方を変える */
  emptiedByFilter: boolean;
  /** このストアの作品を取り切れていないか */
  partial: boolean;
  /** ストアの検索に渡す声優。名前の選び方はストアで違う (`@/app/lib/store-search`) */
  actor: ActorDetail;
}) {
  const t = useT();
  return (
    <section className="space-y-3">
      <h2 className="font-semibold text-xl tracking-tight">{storeLabel(storeSlug)}</h2>
      {partial ? <PartialCoverageNote storeSlug={storeSlug} actor={actor} /> : null}
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
 * このストアの作品を取り切れていないという注記と、ストアの検索への導線。
 *
 * 取れる件数には上限があり、back catalog は取得できた範囲と決めている
 * (`docs/decisions/0010-back-catalog-is-what-was-fetched.md`)。網羅を約束しないことを
 * ここで示し、全作品はストア側で見てもらう。
 *
 * 検索 URL を組み立てられないストアでは注記だけを出す。押せないリンクを出すより、
 * 一部しか載っていない事実だけでも伝わる方が良い。
 * `rel` に `sponsored` を付けないのは、報酬の発生しない検索結果へのリンクだから
 */
function PartialCoverageNote({ storeSlug, actor }: { storeSlug: StoreSlug; actor: ActorDetail }) {
  const t = useT();
  const store = storeLabel(storeSlug);
  const href = storeActorSearchUrl(storeSlug, actor);

  return (
    <p className="text-muted-foreground text-sm">
      {t("actor.partialCoverage", { store })}{" "}
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener nofollow"
          className="inline-flex items-center gap-1 underline underline-offset-4 hover:text-foreground"
        >
          {t("actor.partialCoverageLink", { store })}
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      ) : null}
    </p>
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
