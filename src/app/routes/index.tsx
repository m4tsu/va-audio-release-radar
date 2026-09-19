import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useId, useRef, useState } from "react";
import { ActorSearch } from "@/app/components/actor-search";
import { EmptyState } from "@/app/components/empty-state";
import { storeLabel } from "@/app/components/store-badge";
import { WorkCard } from "@/app/components/work-card";
import { useT } from "@/app/i18n";
import { cn } from "@/app/lib/utils";
import type { WorkWithListings } from "@/app/lib/view-types";
import { fetchLatestWorks } from "@/app/server-fns/works";
import { useFollowStore } from "@/app/store/follow-store";
import { STORE_SLUGS, type StoreSlug } from "@/domain/types";

/** トップに出す新着の範囲。ストアごとに引くので、1 ストアあたりの件数で考える */
const LATEST_SINCE_DAYS = 30;
const LATEST_LIMIT = 12;
/** 最初に開くタブ。作品数がいちばん多いストア */
const DEFAULT_STORE: StoreSlug = "dlsite";

/**
 * トップ。
 *
 * 出すのは「このサービスは何か」「誰を追いたいか (検索)」「今どんな作品が出ているか」の 3 つだけ。
 * フォロー中の作品一覧は /following、一覧からたどる経路は /voice-actors と /anime にあるので、
 * ここではフォローの有無で中身を入れ替えない (初めて来た人と常連が別の画面を見ることになるため)
 */
export const Route = createFileRoute("/")({
  loader: async () => {
    // ストアごとに引くのは、同じ数だけ並べても 1 ストアの発売予定で埋まってしまうため。
    // 3 ストアぶんをまとめて渡し、タブの切り替えでは取り直さない
    const latestByStore = await Promise.all(
      STORE_SLUGS.map(async (storeSlug) => ({
        storeSlug,
        items: await fetchLatestWorks({
          data: { sinceDays: LATEST_SINCE_DAYS, limit: LATEST_LIMIT, storeSlug },
        }),
      })),
    );
    return { latestByStore };
  },
  component: HomePage,
});

type StoreWorks = { storeSlug: StoreSlug; items: WorkWithListings[] };

function HomePage() {
  const { latestByStore } = Route.useLoaderData();

  return (
    <div className="space-y-12">
      <Hero />
      <LatestSection latestByStore={latestByStore} />
      <BrowseSection />
    </div>
  );
}

/** 見出しと検索。初めて来た人がここで名前を入れてフォローに進む */
function Hero() {
  const t = useT();
  return (
    <section className="space-y-4">
      <h1 className="font-semibold text-2xl tracking-tight sm:text-3xl">{t("home.heroTitle")}</h1>
      <ActorSearch />
    </section>
  );
}

/**
 * 新着。ストアごとのタブで出し分ける。
 *
 * 混ぜて新着順に並べると、発売日を先に公開するストア (Audible) の発売予定だけで埋まる。
 * 3 ストアぶんを loader で受け取っているので、タブを切り替えても取り直しは起きない
 */
function LatestSection({ latestByStore }: { latestByStore: StoreWorks[] }) {
  const t = useT();
  const baseId = useId();
  const [active, setActive] = useState<StoreSlug>(DEFAULT_STORE);
  const tabRefs = useRef(new Map<StoreSlug, HTMLButtonElement | null>());
  const current = latestByStore.find((store) => store.storeSlug === active);

  // ← → でタブを移動する (WAI-ARIA の tabs の作法)。端では反対側へ回す
  const moveFocus = (offset: number) => {
    const index = STORE_SLUGS.indexOf(active);
    const next = STORE_SLUGS[(index + offset + STORE_SLUGS.length) % STORE_SLUGS.length];
    if (!next) return;
    setActive(next);
    tabRefs.current.get(next)?.focus();
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold text-xl tracking-tight">{t("home.latestTitle")}</h2>
        <FollowingLink />
      </div>

      <div
        role="tablist"
        aria-label={t("home.latestStoreTabsLabel")}
        className="flex gap-1 border-b"
      >
        {latestByStore.map((store) => {
          const selected = store.storeSlug === active;
          return (
            <button
              key={store.storeSlug}
              ref={(element) => {
                tabRefs.current.set(store.storeSlug, element);
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${store.storeSlug}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${store.storeSlug}`}
              // 選択中のタブだけがタブ順に入る。残りは矢印キーで移動する
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(store.storeSlug)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  moveFocus(1);
                } else if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  moveFocus(-1);
                }
              }}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
                selected
                  ? "border-foreground font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {storeLabel(store.storeSlug)}
            </button>
          );
        })}
      </div>

      {/* パネル自体は tabbable にしない。中の作品リンクが順に拾われるので回る先はある */}
      <div
        role="tabpanel"
        id={`${baseId}-panel-${active}`}
        aria-labelledby={`${baseId}-tab-${active}`}
      >
        {current && current.items.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {current.items.map((item) => (
              <WorkCard key={item.work.id} item={item} />
            ))}
          </div>
        ) : (
          <EmptyState title={t("home.latestStoreEmptyTitle", { store: storeLabel(active) })} />
        )}
      </div>
    </section>
  );
}

/**
 * フォロー中の新着への近道。フォローが 0 件のときは行っても空なので出さない。
 * フォローはブラウザ内にしか無いため、SSR では必ず出ない
 */
function FollowingLink() {
  const t = useT();
  const follows = useFollowStore((state) => state.follows);
  const status = useFollowStore((state) => state.status);

  if (status !== "ready" || follows.length === 0) return null;
  return (
    <Link to="/following" className="text-sm underline underline-offset-4">
      {t("home.latestToFollowing")}
    </Link>
  );
}

/** 名前を知らない人の入口。一覧そのものはページが分かれているので、ここには入口だけ置く */
function BrowseSection() {
  const t = useT();
  return (
    <section className="space-y-4">
      <h2 className="font-semibold text-xl tracking-tight">{t("home.browseTitle")}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <BrowseCard to="/voice-actors" title={t("home.browseActorsTitle")} />
        <BrowseCard to="/anime" title={t("home.browseAnimeTitle")} />
      </div>
    </section>
  );
}

function BrowseCard({ to, title }: { to: "/voice-actors" | "/anime"; title: string }) {
  return (
    <Link
      to={to}
      className="flex items-center justify-between gap-3 rounded-xl border p-4 font-medium transition-colors hover:bg-accent"
    >
      {title}
      <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
