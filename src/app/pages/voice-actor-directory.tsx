import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ActorSearch } from "@/app/components/actor-search";
import { EmptyState } from "@/app/components/empty-state";
import { FollowButton } from "@/app/components/follow-button";
import { PageHeader } from "@/app/components/page-header";
import { SortSelect } from "@/app/components/sort-select";
import { StoreBadge, storeLabel } from "@/app/components/store-badge";
import { Button } from "@/app/components/ui/button";
import { type PlainTKey, useLocale, useT } from "@/app/i18n";
import {
  ACTOR_SORTS,
  type ActorSort,
  arrangeActors,
  availableInitials,
  DEFAULT_ACTOR_SORT,
  isActorSort,
} from "@/app/lib/actor-directory";
import { actorDisplayName } from "@/app/lib/actor-name";
import type { ActorSummary } from "@/app/lib/view-types";
import { STORE_SLUGS, type StoreSlug } from "@/domain/types";

/**
 * 声優の一覧。名前を知らない・思い出せない人がここから声優ページへ入る。
 *
 * 出るのは音声作品が 1 件以上ある声優だけ (`listActors`)。中身は全部 SSR で出して
 * インデックスさせる。声優ページへの内部リンクをまとめて置ける唯一のページでもある。
 *
 * 並べ替えと絞り込み (ストア・頭文字) は `lib/actor-directory` が持つ
 */
export function VoiceActorDirectoryPage({ actors }: { actors: ActorSummary[] }) {
  const t = useT();

  return (
    <div className="space-y-8">
      <PageHeader title={t("voiceActors.title")} />
      <ActorSearch />
      {actors.length === 0 ? (
        <EmptyState title={t("voiceActors.emptyTitle")} />
      ) : (
        <ActorDirectory actors={actors} />
      )}
    </div>
  );
}

/** 並べ替えの選択肢の文言。`ACTOR_SORTS` の各値に 1 つずつ要る */
const SORT_LABEL_KEYS = {
  name: "voiceActors.sortName",
  workCount: "voiceActors.sortWorkCount",
} as const satisfies Record<ActorSort, PlainTKey>;

function ActorDirectory({ actors }: { actors: ActorSummary[] }) {
  const t = useT();
  const locale = useLocale();
  const [sort, setSort] = useState<ActorSort>(DEFAULT_ACTOR_SORT);
  const [store, setStore] = useState<StoreSlug | null>(null);
  const [initial, setInitial] = useState<string | null>(null);
  const initials = useMemo(
    () => availableInitials(actors, { store, locale }),
    [actors, store, locale],
  );
  const shown = useMemo(
    () => arrangeActors(actors, { sort, store, initial, locale }),
    [actors, sort, store, initial, locale],
  );

  /**
   * ストアを変えると押せる頭文字が変わる。選んでいた文字が消えるなら頭文字の絞り込みも解く。
   * 残したままだと 0 人の一覧になり、後でストアを戻したときに押していない文字で絞られる
   */
  const changeStore = (next: StoreSlug | null) => {
    setStore(next);
    if (initial !== null && !availableInitials(actors, { store: next, locale }).includes(initial)) {
      setInitial(null);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <SortSelect
          value={sort}
          options={ACTOR_SORTS}
          labelKeys={SORT_LABEL_KEYS}
          isOption={isActorSort}
          onChange={setSort}
        />
        <StoreFilter value={store} onChange={changeStore} />
        {/* 絞り込みの結果は並びを見ても数えられない。aria-live で操作のたびに読み上げる */}
        <p aria-live="polite" className="ms-auto text-muted-foreground text-sm">
          {t("voiceActors.shownCount", { count: shown.length })}
        </p>
      </div>

      {initials.length > 0 ? (
        <InitialFilter value={initial} initials={initials} onChange={setInitial} />
      ) : null}

      {/* 絞り込んでいなければ 0 人にはならない (呼び出し側が全員 0 人のときを先に弾いている) */}
      {shown.length === 0 && store !== null ? (
        <EmptyState title={t("voiceActors.filteredEmptyTitle", { store: storeLabel(store) })} />
      ) : (
        <ActorList actors={shown} />
      )}
    </section>
  );
}

/**
 * ストアの絞り込み。トップの新着と違ってパネルを切り替えるのではなく 1 つのリストを絞るので、
 * タブではなく押した状態を持つボタンで出す (`aria-pressed`)
 */
function StoreFilter({
  value,
  onChange,
}: {
  value: StoreSlug | null;
  onChange: (next: StoreSlug | null) => void;
}) {
  const t = useT();

  return (
    // ボタンの集まりに名前を付けるための fieldset。見出しは出さず、読み上げ名だけを持たせる
    <fieldset aria-label={t("voiceActors.storeFilterLabel")} className="flex flex-wrap gap-1">
      <FilterButton
        label={t("voiceActors.filterAll")}
        selected={value === null}
        onClick={() => onChange(null)}
      />
      {STORE_SLUGS.map((slug) => (
        <FilterButton
          key={slug}
          label={storeLabel(slug)}
          selected={value === slug}
          onClick={() => onChange(slug)}
        />
      ))}
    </fieldset>
  );
}

/**
 * 頭文字の絞り込み。ローマ字の姓の頭文字を持つ声優が居るときだけ出るので、
 * 日本語表示では出ない (`availableInitials`)。並べ替えを名前順にしていなくても効く
 */
function InitialFilter({
  value,
  initials,
  onChange,
}: {
  value: string | null;
  initials: string[];
  onChange: (next: string | null) => void;
}) {
  const t = useT();

  return (
    <fieldset aria-label={t("voiceActors.initialFilterLabel")} className="flex flex-wrap gap-1">
      <FilterButton
        label={t("voiceActors.filterAll")}
        selected={value === null}
        onClick={() => onChange(null)}
      />
      {initials.map((initial) => (
        <FilterButton
          key={initial}
          label={initial}
          // 1 文字のボタンが文字ごとに違う幅になると、索引として目で追えない
          className="w-9 px-0"
          selected={value === initial}
          onClick={() => onChange(initial)}
        />
      ))}
    </fieldset>
  );
}

function FilterButton({
  label,
  selected,
  className,
  onClick,
}: {
  label: string;
  selected: boolean;
  className?: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={selected ? "default" : "outline"}
      aria-pressed={selected}
      className={className}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

/**
 * 声優の行。名前と作品数のほかに、どのストアに作品があるかと、その場でのフォローを置く。
 * 一覧から声優ページへ往復せずにフォローを済ませられるようにするため
 */
function ActorList({ actors }: { actors: ActorSummary[] }) {
  const t = useT();
  const locale = useLocale();

  return (
    <ul aria-label={t("voiceActors.title")} className="grid gap-2 lg:grid-cols-2">
      {actors.map((actor) => (
        // min-w-0 が無いと、いちばん長い行の幅で列が決まり、どの行も画面からはみ出す
        <li
          key={actor.id}
          className="flex min-w-0 items-center justify-between gap-2 rounded-xl border px-3 py-2"
        >
          <Link
            to="/voice-actors/$slug"
            params={{ slug: actor.slug }}
            className="min-w-0 hover:underline"
          >
            <span className="block truncate font-medium text-sm">
              {actorDisplayName(actor, locale)}
            </span>
            <span className="text-muted-foreground text-xs">
              {t("common.worksCount", { count: actor.workCount })}
            </span>
          </Link>
          <div className="flex shrink-0 items-center gap-1">
            {/* 狭い画面では名前とフォローを優先する。どのストアかは絞り込みでも分かる */}
            {actor.storeSlugs.map((slug) => (
              <StoreBadge key={slug} store={slug} className="hidden sm:inline-flex" />
            ))}
            <FollowButton
              actor={{
                voiceActorId: actor.id,
                slug: actor.slug,
                canonicalName: actor.canonicalName,
                ...(actor.nameEn ? { nameEn: actor.nameEn } : {}),
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
