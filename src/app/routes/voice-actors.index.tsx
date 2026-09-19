import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpDown } from "lucide-react";
import { useMemo, useState } from "react";
import { ActorSearch } from "@/app/components/actor-search";
import { EmptyState } from "@/app/components/empty-state";
import { FollowButton } from "@/app/components/follow-button";
import { PageHeader } from "@/app/components/page-header";
import { StoreBadge, storeLabel } from "@/app/components/store-badge";
import { Button } from "@/app/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { createTranslator, type TKey, useLocale, useT } from "@/app/i18n";
import {
  ACTOR_SORTS,
  type ActorSort,
  arrangeActors,
  DEFAULT_ACTOR_SORT,
  isActorSort,
} from "@/app/lib/actor-directory";
import { actorDisplayName } from "@/app/lib/actor-name";
import type { ActorSummary } from "@/app/lib/view-types";
import { fetchAllActors } from "@/app/server-fns/actors";
import { siteOriginForLoader } from "@/app/server-fns/site";
import { STORE_SLUGS, type StoreSlug } from "@/domain/types";

/**
 * 声優の一覧。名前を知らない・思い出せない人がここから声優ページへ入る。
 *
 * 出るのは音声作品が 1 件以上ある声優だけ (`listActors`)。中身は全部 SSR で出して
 * インデックスさせる。声優ページへの内部リンクをまとめて置ける唯一のページでもある。
 *
 * 並べ替えとストアの絞り込みは `lib/actor-directory` が持つ
 */
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
  component: VoiceActorsPage,
});

function VoiceActorsPage() {
  const t = useT();
  const { actors } = Route.useLoaderData();

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
} as const satisfies Record<ActorSort, TKey>;

function ActorDirectory({ actors }: { actors: ActorSummary[] }) {
  const t = useT();
  const [sort, setSort] = useState<ActorSort>(DEFAULT_ACTOR_SORT);
  const [store, setStore] = useState<StoreSlug | null>(null);
  const shown = useMemo(() => arrangeActors(actors, { sort, store }), [actors, sort, store]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <SortSelect value={sort} onChange={setSort} />
        <StoreFilter value={store} onChange={setStore} />
        {/* 絞り込みの結果は並びを見ても数えられない。aria-live で操作のたびに読み上げる */}
        <p aria-live="polite" className="ms-auto text-muted-foreground text-sm">
          {t("voiceActors.shownCount", { count: shown.length })}
        </p>
      </div>

      {/* 絞り込んでいなければ 0 人にはならない (呼び出し側が全員 0 人のときを先に弾いている) */}
      {shown.length === 0 && store !== null ? (
        <EmptyState title={t("voiceActors.filteredEmptyTitle", { store: storeLabel(store) })} />
      ) : (
        <ActorList actors={shown} />
      )}
    </section>
  );
}

/** 並べ替え。画面には選ばれている方しか出ないので、読み上げ名に役割と今の値の両方を畳み込む */
function SortSelect({
  value,
  onChange,
}: {
  value: ActorSort;
  onChange: (next: ActorSort) => void;
}) {
  const t = useT();

  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (isActorSort(next)) onChange(next);
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label={t("voiceActors.sortLabel", { name: t(SORT_LABEL_KEYS[value]) })}
      >
        <ArrowUpDown aria-hidden="true" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ACTOR_SORTS.map((option) => (
          <SelectItem key={option} value={option}>
            {t(SORT_LABEL_KEYS[option])}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
        label={t("voiceActors.storeFilterAll")}
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

function FilterButton({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={selected ? "default" : "outline"}
      aria-pressed={selected}
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
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
