import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActorSearch } from "@/app/components/actor-search";
import { EmptyState } from "@/app/components/empty-state";
import { FollowButton } from "@/app/components/follow-button";
import { PageHeader } from "@/app/components/page-header";
import { SortSelect } from "@/app/components/sort-select";
import { StoreBadge, storeLabel } from "@/app/components/store-badge";
import { Button } from "@/app/components/ui/button";
import { type PlainTKey, useLocale, useT } from "@/app/i18n";
import {
  ACTOR_GENDER_FILTERS,
  ACTOR_SORTS,
  type ActorGenderFilter,
  type ActorSort,
  arrangeActors,
  availableInitials,
  DEFAULT_ACTOR_GENDER_FILTER,
  DEFAULT_ACTOR_SORT,
  isActorSort,
} from "@/app/lib/actor-directory";
import { actorDisplayName } from "@/app/lib/actor-name";
import type { ActorSummary } from "@/app/lib/view-types";
import { STORE_SLUGS, type StoreSlug } from "@/domain/types";

/**
 * 声優の一覧。名前を知らない・思い出せない人がここから声優ページへ入る。
 *
 * 受け取るのはページが出る声優全員で、音声作品がまだ 1 件も無い人も入る (`listActors`)。
 * 並べ替えと絞り込みを全員に効かせるため全員ぶんを持つが、描くのは `INITIAL_VISIBLE` 人までで、
 * 残りは「すべて表示」を押したときに出す。
 *
 * 並べ替えと絞り込み (ストア・性別・頭文字) は `lib/actor-directory` が持つ。
 * 性別は絞り込みの軸にするだけで、誰がどの性別かは画面のどこにも書かない
 * (出どころが利用者の編集できる外部 DB なので、誤りを人物の属性として掲示しない)
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

/**
 * 開いた直後に描く人数。
 *
 * 1 行のマークアップは中身の数十倍あるので、全員を描くと HTML が数 MB になり、
 * その全部をハイドレートすることになる。データは全員ぶん手元にあるので、押せば取得せずに出せる
 */
const INITIAL_VISIBLE = 100;

/** 並べ替えの選択肢の文言。`ACTOR_SORTS` の各値に 1 つずつ要る */
const SORT_LABEL_KEYS = {
  name: "voiceActors.sortName",
  workCount: "voiceActors.sortWorkCount",
} as const satisfies Record<ActorSort, PlainTKey>;

/** 性別の絞り込みの文言。`ACTOR_GENDER_FILTERS` の各値に 1 つずつ要る */
const GENDER_LABEL_KEYS = {
  // ストアの「すべて」と並ぶので同じ文言にしない。隣り合う 2 つの「すべて」は押す前に区別が付かない
  all: "voiceActors.genderAll",
  female: "voiceActors.genderFemale",
  male: "voiceActors.genderMale",
  other: "voiceActors.genderOther",
} as const satisfies Record<ActorGenderFilter, PlainTKey>;

function ActorDirectory({ actors }: { actors: ActorSummary[] }) {
  const t = useT();
  const locale = useLocale();
  const [sort, setSort] = useState<ActorSort>(DEFAULT_ACTOR_SORT);
  const [store, setStore] = useState<StoreSlug | null>(null);
  const [gender, setGender] = useState<ActorGenderFilter>(DEFAULT_ACTOR_GENDER_FILTER);
  const [initial, setInitial] = useState<string | null>(null);
  // 一度押したら以後は解かない。並べ替えや絞り込みのたびに畳み直すと、押した操作が無かったことになる
  const [expanded, setExpanded] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const initials = useMemo(
    () => availableInitials(actors, { store, gender, locale }),
    [actors, store, gender, locale],
  );
  const shown = useMemo(
    () => arrangeActors(actors, { sort, store, gender, initial, locale }),
    [actors, sort, store, gender, initial, locale],
  );
  // 切るのは並べ替えと絞り込みを通した後。先に切ると、切り取った中だけを並べ替えることになる
  const visible = expanded ? shown : shown.slice(0, INITIAL_VISIBLE);
  const truncated = visible.length < shown.length;

  /**
   * 「すべて表示」は押すと自分が消えるので、focus が body へ落ちる。そのままだと次の Tab が
   * 文書の先頭からになり、キーボードでは出したばかりの行へ 100 行たどり直すことになる。
   * 最初に現れた行へ focus を移す
   */
  useEffect(() => {
    if (!expanded) return;
    const firstRevealed = listRef.current?.children[INITIAL_VISIBLE];
    firstRevealed?.querySelector("a")?.focus();
  }, [expanded]);

  /**
   * ストアを変えると押せる頭文字が変わる。選んでいた文字が消えるなら頭文字の絞り込みも解く。
   * 残したままだと 0 人の一覧になり、後でストアを戻したときに押していない文字で絞られる
   */
  const changeStore = (next: StoreSlug | null) => {
    setStore(next);
    dropInitialIfGone({ store: next, gender });
  };

  /** 性別を変えたときも押せる頭文字が変わる。理由は `changeStore` と同じ */
  const changeGender = (next: ActorGenderFilter) => {
    setGender(next);
    dropInitialIfGone({ store, gender: next });
  };

  function dropInitialIfGone(next: { store: StoreSlug | null; gender: ActorGenderFilter }) {
    if (initial !== null && !availableInitials(actors, { ...next, locale }).includes(initial)) {
      setInitial(null);
    }
  }

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
        <GenderFilter value={gender} onChange={changeGender} />
        {/* 絞り込みの結果は並びを見ても数えられない。aria-live で操作のたびに読み上げる */}
        <p aria-live="polite" className="ms-auto text-muted-foreground text-sm">
          {truncated
            ? t("voiceActors.shownOfTotal", { count: visible.length, total: shown.length })
            : t("voiceActors.shownCount", { count: shown.length })}
        </p>
      </div>

      {initials.length > 0 ? (
        <InitialFilter value={initial} initials={initials} onChange={setInitial} />
      ) : null}

      {/* 絞り込んでいなければ 0 人にはならない (呼び出し側が全員 0 人のときを先に弾いている)。
          どの軸で 0 人になったかを文にしないのは、軸が 3 つあって 1 つだけを名指しすると嘘になるため */}
      {shown.length === 0 ? (
        <EmptyState title={t("voiceActors.filteredEmptyTitle")} />
      ) : (
        <>
          <ActorList ref={listRef} actors={visible} />
          {truncated ? (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => setExpanded(true)}
            >
              {t("voiceActors.showAll")}
            </Button>
          ) : null}
        </>
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
 * 性別の絞り込み。全員 / 女性 / 男性 / その他 の 4 つで、一覧の全員がどれか 1 つに必ず入る。
 * 「その他」に性別が分かっていない声優が入ることは `lib/actor-directory` が決める
 */
function GenderFilter({
  value,
  onChange,
}: {
  value: ActorGenderFilter;
  onChange: (next: ActorGenderFilter) => void;
}) {
  const t = useT();

  return (
    <fieldset aria-label={t("voiceActors.genderFilterLabel")} className="flex flex-wrap gap-1">
      {ACTOR_GENDER_FILTERS.map((filter) => (
        <FilterButton
          key={filter}
          label={t(GENDER_LABEL_KEYS[filter])}
          selected={value === filter}
          onClick={() => onChange(filter)}
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
function ActorList({
  actors,
  ref,
}: {
  actors: ActorSummary[];
  /** 「すべて表示」の後に focus を移す先を探すために要る (`ActorDirectory`) */
  ref?: React.Ref<HTMLUListElement>;
}) {
  const t = useT();
  const locale = useLocale();

  return (
    <ul ref={ref} aria-label={t("voiceActors.title")} className="grid gap-2 lg:grid-cols-2">
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
