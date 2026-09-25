import { Link } from "@tanstack/react-router";
import { ArrowDown, ExternalLink, Store, Tag, Users } from "lucide-react";
import { type ReactNode, useState } from "react";
import { CorrectionLink } from "@/app/components/correction-link";
import { EmptyState } from "@/app/components/empty-state";
import { FollowButton } from "@/app/components/follow-button";
import { PageHeader } from "@/app/components/page-header";
import { PushFollowPrompt } from "@/app/components/push-follow-prompt";
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
import { APPEARANCE_FILTERS, appearanceLabel, isAppearanceFilter } from "@/app/lib/appearance";
import { characterDisplayName } from "@/app/lib/character-name";
import { categoryLabel, formatYearMonth } from "@/app/lib/format";
import { safeHttpsUrl } from "@/app/lib/safe-url";
import { seasonLabel } from "@/app/lib/season";
import { storeActorSearchUrl } from "@/app/lib/store-search";
import { sendUsageEvent } from "@/app/lib/usage-events";
import type {
  ActorAnimeAppearance,
  ActorDetail,
  ActorStoreCoverage,
  ActorWorkStats,
  WorkWithListings,
} from "@/app/lib/view-types";
import {
  CATEGORY_FILTERS,
  filterWorks,
  isCategoryFilter,
  isStoreFilter,
  STORE_FILTERS,
  type WorkFilters,
} from "@/app/lib/work-filters";
import { useIsFollowing } from "@/app/store/follow-store";
import type { StoreSlug } from "@/domain/types";

/** 出演アニメの見出しの id。見出しの下のページ内リンクの飛び先 */
const ANIME_SECTION_ID = "recent-anime";

/**
 * 音声作品が 1 件でもあるか。ルートはこれを見て `robots` の指定を決めるので、
 * 画面とルートで判定がずれないようここから出す
 */
export function hasAnyWork(works: readonly WorkWithListings[]): boolean {
  return works.length > 0;
}

/**
 * 声優ページ。「{声優名} ASMR」「{声優名} Audible」のような
 * 実体検索での流入を受ける想定なので、中身は全部 SSR で出しインデックスさせる。
 *
 * 作品はストアごとに割らず、発売日の新しい順の 1 本に並べる。同じ人の作品が 3 つに割れると、
 * どのストアを見ても数件ずつになり「この人は何を出しているか」が読めない
 * (`docs/decisions/0014-actor-page-one-timeline.md`)。ストア・区分・出演形態は
 * その 1 本を絞る軸として上に置く。
 *
 * 音声作品がまだ 1 件も無い声優のページも出す。「初めての 1 本」を待つ人のフォローを
 * 受けるためで、そのときは一覧も絞り込みも実績も出さず、まだ見つかっていないことを 1 つ出す
 * (`docs/decisions/0012-follow-actors-without-works.md`)。
 *
 * クライアントでしか決まらないのはフォローボタンの状態と、フォローした直後に出す通知の案内だけ。
 * 絞り込みは URL の検索文字列に
 * 置く (ルートが読む)。ページ内の状態にすると、絞った画面を共有も再読み込みもできず、
 * SSR が返す HTML と食い違う
 */
export function VoiceActorPage({
  actor,
  works,
  stats,
  anime,
  coverage,
  filters,
  onFiltersChange,
  vapidPublicKey,
}: {
  actor: ActorDetail;
  /** 発売日の新しい順。上限で切ってあるので、件数は `stats` の方が正しい */
  works: WorkWithListings[];
  /** この声優の作品数と最新リリース。作品が 1 件も無ければ `workCount` が 0 */
  stats: ActorWorkStats;
  anime: ActorAnimeAppearance[];
  /** ストアごとの網羅の状態。走行の記録が無いストアは入っていない */
  coverage: ActorStoreCoverage[];
  /** 絞り込み。URL から来る */
  filters: WorkFilters;
  onFiltersChange: (next: WorkFilters) => void;
  /** 新作の通知の公開鍵。無い環境ではフォロー直後の案内を出さない */
  vapidPublicKey: string | null;
}) {
  const t = useT();
  const locale = useLocale();
  const name = actorDisplayName(actor, locale);
  // このページでフォローを押した声優。開いた時点でフォロー済みの人には通知の案内を出さない。
  // 真偽値にしないのは、声優から声優へ移ってもページが作り直されず、状態が次の声優に残るため
  const [followedHereId, setFollowedHereId] = useState<string | null>(null);
  const following = useIsFollowing(actor.id);
  // 取り切れていないストア。取り切れたストアと、走行の記録が無いストアは入らない
  const partialStores = coverage.filter((entry) => !entry.complete).map((entry) => entry.storeSlug);

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("actor.title", { name })}
        // 読み仮名も実績も無ければ副題そのものを出さない (空の行が見出しの下に開く)
        description={
          actor.nameKana || stats.workCount > 0 ? (
            <ActorSubtitle actor={actor} stats={stats} jumpToAnime={anime.length > 0} />
          ) : undefined
        }
        actions={
          <FollowButton
            size="default"
            actor={{
              voiceActorId: actor.id,
              slug: actor.slug,
              canonicalName: actor.canonicalName,
              ...(actor.nameEn ? { nameEn: actor.nameEn } : {}),
            }}
            onFollow={() => {
              setFollowedHereId(actor.id);
              // 声優ページ → フォローの転換率の分子。誰をフォローしたかは送らない
              sendUsageEvent({ type: "follow" });
            }}
          />
        }
      />

      {followedHereId === actor.id && following ? (
        <PushFollowPrompt vapidPublicKey={vapidPublicKey} />
      ) : null}

      {hasAnyWork(works) ? (
        <WorkSection
          works={works}
          total={stats.workCount}
          filters={filters}
          onFiltersChange={onFiltersChange}
          partialStores={partialStores}
          actor={actor}
        />
      ) : (
        <NoWorksYet actor={actor} partialStores={partialStores} />
      )}

      {anime.length > 0 ? <AnimeSection items={anime} /> : null}

      {/* 別名義が結び付いていないことに気づくのは、作品と出演アニメを見比べた後 */}
      <CorrectionLink path={`/voice-actors/${actor.slug}`} />
    </div>
  );
}

/**
 * 見出しの下。読み仮名と、フォローを押す前に知りたい実績 (作品数と最新リリース) を出す。
 *
 * 作品が 1 件も無い声優には実績を出さない。「0 作品」は数えた結果ではなく、
 * まだ見つかっていないという状態で、それは一覧の側が 1 枚の案内として言う。
 *
 * 出演アニメは作品一覧の後ろにあり、作品が多いと視界に入らないので、ここから飛ぶリンクを置く。
 * 作品が無ければ出演アニメは案内のすぐ下にあるので置かない
 */
function ActorSubtitle({
  actor,
  stats,
  jumpToAnime,
}: {
  actor: ActorDetail;
  stats: ActorWorkStats;
  /** 出演アニメがあるか */
  jumpToAnime: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  if (stats.workCount === 0) return actor.nameKana ?? null;

  const facts = [
    t("common.worksCount", { count: stats.workCount }),
    ...(stats.latestReleaseDate
      ? [t("actor.latestRelease", { date: formatYearMonth(stats.latestReleaseDate, locale) })]
      : []),
  ];

  return (
    <>
      {actor.nameKana ? <span className="block">{actor.nameKana}</span> : null}
      <span className="block">{facts.join(t("common.slashSeparator"))}</span>
      {jumpToAnime ? (
        <a
          href={`#${ANIME_SECTION_ID}`}
          className="mt-1 inline-flex items-center gap-1 underline underline-offset-4 hover:text-foreground"
        >
          <ArrowDown className="size-3.5" aria-hidden="true" />
          {t("actor.jumpToAnime")}
        </a>
      ) : null}
    </>
  );
}

/** 作品の一覧と、その上の絞り込み。作品が 1 件でもあるときだけ出る */
function WorkSection({
  works,
  total,
  filters,
  onFiltersChange,
  partialStores,
  actor,
}: {
  works: WorkWithListings[];
  /** 上限で切る前の作品数 */
  total: number;
  filters: WorkFilters;
  onFiltersChange: (next: WorkFilters) => void;
  /** 取り切れていないストア */
  partialStores: StoreSlug[];
  actor: ActorDetail;
}) {
  const t = useT();
  const locale = useLocale();
  // 絞るのはルートが取ってきた範囲の中だけ。件数には上限があり
  // (`routes/voice-actors.$slug.tsx`)、その先にある該当作品は出ない。
  // 上限は新着を追うための打ち切りなので、絞り込みのたびに動かさない
  const shown = filterWorks(works, filters);
  // 上限で切ったかどうか。切ったときは並び順を注記で言う。絞り込みの件数と混ぜると、
  // 「200 作品中 2 作品」が「このストアに 2 作品しか無い」と読めてしまう
  const truncated = works.length < total;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <FilterSelect
          axis={t("actor.storeFilterName")}
          icon={<Store aria-hidden="true" />}
          value={filters.store}
          options={STORE_FILTERS}
          optionLabel={(option) => (option === "all" ? t("common.filterAll") : storeLabel(option))}
          isOption={isStoreFilter}
          onChange={(store) => onFiltersChange({ ...filters, store })}
        />
        <FilterSelect
          axis={t("actor.categoryFilterName")}
          icon={<Tag aria-hidden="true" />}
          value={filters.category}
          options={CATEGORY_FILTERS}
          optionLabel={(option) =>
            option === "all" ? t("common.filterAll") : categoryLabel(option, locale)
          }
          isOption={isCategoryFilter}
          onChange={(category) => onFiltersChange({ ...filters, category })}
        />
        <FilterSelect
          axis={t("appearance.filterName")}
          icon={<Users aria-hidden="true" />}
          value={filters.appearance}
          options={APPEARANCE_FILTERS}
          optionLabel={(option) =>
            option === "all" ? t("common.filterAll") : appearanceLabel(option, locale)
          }
          isOption={isAppearanceFilter}
          onChange={(appearance) => onFiltersChange({ ...filters, appearance })}
        />
        {/* 絞り込みの結果は並びを見ても数えられない。aria-live で操作のたびに読み上げる。
            分母は一覧に並べた件数で、この声優の作品数 (見出しの下) ではない */}
        <p aria-live="polite" className="ms-auto text-muted-foreground text-sm">
          {shown.length === works.length
            ? t("common.worksCount", { count: shown.length })
            : t("actor.shownOfListed", { count: shown.length, total: works.length })}
        </p>
      </div>

      {/* 区画が無くなっても、取り切れていないストアの注記は一覧の手前に残す
          (`docs/decisions/0010-back-catalog-is-what-was-fetched.md`)。
          上限で切ったときは並び順 (新着順) を同じ場所で言う。見出しの作品数と並んだ件数が
          違う理由が、新しい方から載せていることで読める */}
      {partialStores.length > 0 || truncated ? (
        <div className="space-y-1">
          {truncated ? (
            <p className="text-muted-foreground text-sm">{t("actor.listLimited")}</p>
          ) : null}
          {partialStores.map((storeSlug) => (
            <PartialCoverageNote key={storeSlug} storeSlug={storeSlug} actor={actor} />
          ))}
        </div>
      ) : null}

      {/* 絞り込みの軸が 3 つあって、どれで 0 件になったかを 1 つ名指しすると嘘になる */}
      {shown.length === 0 ? (
        <EmptyState title={t("actor.filteredEmptyTitle")} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {shown.map((item) => (
            <WorkCard key={item.work.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * 一覧を絞る欄。ストア・区分・出演形態が横に並ぶので、選ばれている値だけでなく
 * 軸の名前も欄に出す。どれも「すべて」を選べるため、値だけでは押す前に見分けが付かない。
 *
 * ネイティブの `<select>` を使わない理由は `locale-select.tsx` と同じ
 */
function FilterSelect<T extends string>({
  axis,
  icon,
  value,
  options,
  optionLabel,
  isOption,
  onChange,
}: {
  /** 軸の名前 ("ストア" など) */
  axis: string;
  icon: ReactNode;
  value: T;
  options: readonly T[];
  optionLabel: (option: T) => string;
  /** Radix は文字列で返すので、受け取ってよい値かを呼び出し側の型で確かめる */
  isOption: (candidate: string) => candidate is T;
  onChange: (next: T) => void;
}) {
  const t = useT();
  const label = t("common.filterLabel", { axis, name: optionLabel(value) });

  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (isOption(next)) onChange(next);
      }}
    >
      <SelectTrigger size="sm" aria-label={label}>
        {icon}
        {/* Radix は選ばれた項目の文言を SelectItem から流し込む。開くまで項目が描かれず
            SSR では空のまま返るので、文言をここで直接渡す */}
        <SelectValue>{label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {optionLabel(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * 音声作品が 1 件も無いとき。並べるものが無いので、絞り込みも作品数も出さず案内を 1 つだけ出す。
 *
 * 取り切れていないストアがあれば、そのストアの検索へ送る。ここに出ていないことは
 * 「そのストアに無い」ではない (`docs/decisions/0010-back-catalog-is-what-was-fetched.md`)
 */
function NoWorksYet({ actor, partialStores }: { actor: ActorDetail; partialStores: StoreSlug[] }) {
  const t = useT();
  return (
    <EmptyState
      title={t("actor.noWorksYetTitle")}
      description={t("actor.noWorksYetDescription")}
      action={
        partialStores.length > 0 ? (
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1">
            {partialStores.map((storeSlug) => (
              <StoreSearchLink key={storeSlug} storeSlug={storeSlug} actor={actor} />
            ))}
          </div>
        ) : undefined
      }
    />
  );
}

/**
 * このストアの作品を取り切れていないという注記と、ストアの検索への導線。
 *
 * 取れる件数には上限があり、back catalog は取得できた範囲と決めている
 * (`docs/decisions/0010-back-catalog-is-what-was-fetched.md`)。網羅を約束しないことを
 * ここで示し、全作品はストア側で見てもらう。
 *
 * 検索 URL を組み立てられないストアでは注記だけを出す (`StoreSearchLink`)
 */
function PartialCoverageNote({ storeSlug, actor }: { storeSlug: StoreSlug; actor: ActorDetail }) {
  const t = useT();
  const store = storeLabel(storeSlug);

  return (
    <p className="text-muted-foreground text-sm">
      {t("actor.partialCoverage", { store })}{" "}
      <StoreSearchLink storeSlug={storeSlug} actor={actor} />
    </p>
  );
}

/**
 * そのストアでこの声優の作品を探すリンク。検索 URL を組み立てられないストアでは何も出さない。
 * 押せないリンクを出すより、注記だけでも伝わる方が良い。
 * `rel` に `sponsored` を付けないのは、報酬の発生しない検索結果へのリンクだから
 */
function StoreSearchLink({ storeSlug, actor }: { storeSlug: StoreSlug; actor: ActorDetail }) {
  const t = useT();
  const href = storeActorSearchUrl(storeSlug, actor);
  if (!href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener nofollow"
      className="inline-flex items-center gap-1 underline underline-offset-4 hover:text-foreground"
    >
      {t("actor.partialCoverageLink", { store: storeLabel(storeSlug) })}
      <ExternalLink className="size-3.5" aria-hidden="true" />
    </a>
  );
}

/**
 * 直近出演アニメ。本人を特定するための手がかりとして出すので、役名と作品名だけに留める。
 * あらすじも話数も持たない (docs/product.md の「作らないもの」)。
 * 並ぶのは新しいシーズンから上限件数までなので、見出しで直近と言う
 */
function AnimeSection({ items }: { items: ActorAnimeAppearance[] }) {
  const t = useT();
  const locale = useLocale();
  return (
    <section className="space-y-3">
      <h2 id={ANIME_SECTION_ID} className="font-semibold text-xl tracking-tight">
        {t("actor.animeTitle")}
      </h2>
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
