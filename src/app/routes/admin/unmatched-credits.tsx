import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useId, useState } from "react";
import { ADMIN_HEAD_META, AdminUnauthorized } from "@/app/components/admin-gate";
import { PageHeader } from "@/app/components/page-header";
import { storeLabel } from "@/app/components/store-badge";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { createTranslator, useLocale, useT } from "@/app/i18n";
import { actorDisplayName } from "@/app/lib/actor-name";
import { handleAdminTokenQuery } from "@/app/lib/admin-token";
import type { ActorSummary, UnmatchedCreditGroup } from "@/app/lib/view-types";
import { fetchAllActors } from "@/app/server-fns/actors";
import { assignCreditFn, fetchUnmatchedCredits } from "@/app/server-fns/admin";
import { fetchAdminSession } from "@/app/server-fns/admin-session";

/**
 * 1 度に出す未解決の表記の数。
 *
 * かつては D1 の bound parameter 上限 (100) を避けるため 50 に絞っていた。
 * `listUnmatchedCredits` が表記名を 1 つの IN 句に並べていたためで、
 * 表記 100 件 + confidence の 1 件で上限を超えていた。
 * いまは `src/server/queries/admin.ts` が `chunked()` で IN 句を 90 件ずつに切るので、
 * この定数は「1 画面に何件出すか」だけの話に戻っている (T6)
 */
const GROUPS_PER_PAGE = 100;

/**
 * 未解決クレジットの割り当て (設計書 §7)。
 *
 * 名寄せできなかったストア上の表記を、人が見て声優に結び付ける。
 * 割り当ては「表記 × ストア」単位でまとめて行う。同じ声優が同じ表記で何十作品にも出るため
 */
export const Route = createFileRoute("/admin/unmatched-credits")({
  server: {
    handlers: {
      GET: async ({ request, next }) => (await handleAdminTokenQuery(request)) ?? next(),
    },
  },
  loader: async () => {
    const session = await fetchAdminSession();
    if (!session.authorized) return { authorized: false as const, configured: session.configured };

    const [groups, actors] = await Promise.all([
      fetchUnmatchedCredits({ data: { limit: GROUPS_PER_PAGE } }),
      fetchAllActors(),
    ]);
    return { authorized: true as const, groups, actors };
  },
  head: ({ match }) => ({
    meta: [
      { title: createTranslator(match.context.locale)("admin.unmatchedMetaTitle") },
      ...ADMIN_HEAD_META,
    ],
  }),
  component: UnmatchedCreditsPage,
});

function UnmatchedCreditsPage() {
  const t = useT();
  const data = Route.useLoaderData();
  if (!data.authorized) return <AdminUnauthorized configured={data.configured} />;

  return (
    <div>
      <PageHeader
        title={t("admin.unmatchedTitle")}
        description={t("admin.unmatchedSummary", { count: data.groups.length })}
        actions={
          <Link to="/admin/crawler-health" className="text-sm underline underline-offset-4">
            {t("admin.unmatchedToHealth")}
          </Link>
        }
      />

      {data.groups.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("admin.unmatchedEmpty")}</p>
      ) : (
        <ul className="space-y-4">
          {data.groups.map((group) => (
            <li key={`${group.sourceStoreSlug}:${group.creditedName}`}>
              <CreditGroupCard group={group} actors={data.actors} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CreditGroupCard({
  group,
  actors,
}: {
  group: UnmatchedCreditGroup;
  actors: ActorSummary[];
}) {
  const t = useT();
  return (
    <div className="space-y-4 rounded-xl border bg-card p-4 text-card-foreground shadow-sm">
      <div className="flex flex-wrap items-baseline gap-2">
        {/* 表記そのものはストア上の書き方。訳さない */}
        <span className="font-medium text-lg">{group.creditedName}</span>
        <Badge variant="outline">{storeLabel(group.sourceStoreSlug)}</Badge>
        <span className="text-muted-foreground text-sm">
          {t("admin.unmatchedCount", { count: group.count })}
        </span>
      </div>

      {group.sampleWorks.length > 0 ? (
        <ul className="space-y-1 text-sm">
          {group.sampleWorks.map((work) => (
            <li key={work.id}>
              <Link
                to="/works/$id"
                params={{ id: work.id }}
                className="text-muted-foreground hover:text-foreground hover:underline"
              >
                {work.title}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      <AssignForm group={group} actors={actors} />
    </div>
  );
}

type SubmitState = { phase: "idle" | "saving" } | { phase: "error"; message: string };

/**
 * 割り当てフォーム。候補 (正規化後の名前が一致する声優) があれば最初から選んでおく。
 *
 * エイリアス登録は既定で on。次回以降の ingest が同じ表記を自動で解決できるようになり、
 * 同じ作業を繰り返さずに済む
 */
function AssignForm({ group, actors }: { group: UnmatchedCreditGroup; actors: ActorSummary[] }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const filterId = useId();
  const selectId = useId();
  const aliasId = useId();

  const [filter, setFilter] = useState("");
  const [voiceActorId, setVoiceActorId] = useState(group.candidate?.id ?? "");
  const [addAlias, setAddAlias] = useState(true);
  const [state, setState] = useState<SubmitState>({ phase: "idle" });

  const needle = filter.trim();
  const visible =
    needle.length === 0
      ? actors
      : actors.filter(
          (actor) =>
            actor.canonicalName.includes(needle) || (actor.nameKana?.includes(needle) ?? false),
        );

  const submit = async () => {
    if (!voiceActorId) return;
    setState({ phase: "saving" });
    try {
      await assignCreditFn({
        data: {
          creditedName: group.creditedName,
          sourceStoreSlug: group.sourceStoreSlug,
          voiceActorId,
          addAlias,
        },
      });
      // 割り当てた表記は一覧から消える。ローダーを引き直して反映する
      await router.invalidate();
    } catch (error) {
      setState({
        phase: "error",
        message: error instanceof Error ? error.message : t("admin.unmatchedError"),
      });
    }
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {group.candidate ? (
        <p className="text-sm">
          {t("admin.unmatchedCandidate")}{" "}
          <span className="font-medium">{actorDisplayName(group.candidate, locale)}</span>
        </p>
      ) : (
        <p className="text-muted-foreground text-sm">{t("admin.unmatchedNoCandidate")}</p>
      )}

      <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
        <div className="space-y-1">
          <Label htmlFor={filterId}>{t("admin.unmatchedFilterLabel")}</Label>
          <Input
            id={filterId}
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t("admin.unmatchedFilterPlaceholder")}
            autoComplete="off"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor={selectId}>{t("admin.unmatchedSelectLabel")}</Label>
          <select
            id={selectId}
            value={voiceActorId}
            onChange={(event) => setVoiceActorId(event.target.value)}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="">{t("admin.unmatchedSelectPlaceholder")}</option>
            {visible.map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actorDisplayName(actor, locale)}
                {actor.nameKana ? ` (${actor.nameKana})` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={aliasId} className="flex items-center gap-2 text-sm">
          <input
            id={aliasId}
            type="checkbox"
            checked={addAlias}
            onChange={(event) => setAddAlias(event.target.checked)}
            className="size-4 accent-primary"
          />
          {t("admin.unmatchedAddAlias")}
        </label>

        <Button type="submit" size="sm" disabled={!voiceActorId || state.phase === "saving"}>
          {state.phase === "saving"
            ? t("admin.unmatchedSaving")
            : t("admin.unmatchedSubmit", { count: group.count })}
        </Button>
      </div>

      {state.phase === "error" ? <p className="text-destructive text-sm">{state.message}</p> : null}
    </form>
  );
}
