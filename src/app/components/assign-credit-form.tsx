import { useRouter } from "@tanstack/react-router";
import { useId, useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { useLocale, useT } from "@/app/i18n";
import { actorDisplayName } from "@/app/lib/actor-name";
import type { ActorSummary, UnmatchedCreditGroup } from "@/app/lib/view-types";
import { assignCreditFn } from "@/app/server-fns/admin";

type SubmitState = { phase: "idle" | "saving" } | { phase: "error"; message: string };

/**
 * 未解決の表記を声優に割り当てるフォーム。候補 (正規化後の名前が一致する声優) があれば
 * 最初から選んでおく。
 *
 * エイリアス登録は既定で on。次回以降の ingest が同じ表記を自動で解決できるようになり、
 * 同じ作業を繰り返さずに済む。
 *
 * 送信はブラウザから直接 server function を呼ぶので、ページではなく部品に置く
 * (ページはデータを props で受け取るだけで、サーバーを呼ばない)
 */
export function AssignCreditForm({
  group,
  actors,
}: {
  group: UnmatchedCreditGroup;
  actors: ActorSummary[];
}) {
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
